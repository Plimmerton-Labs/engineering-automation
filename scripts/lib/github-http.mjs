// Shared low-level HTTP helpers for GitHub REST API clients.
//
// Split out from github-client.mjs when the lifecycle-sync automation (issue #26)
// needed write access (labels, comments, closing issues) in addition to the
// preflight verifier's read-only needs (issue #21). The split is deliberate, not just
// deduplication: github-client.mjs's read-only contract is a real security property
// documented in its own file header ("the preflight verifier must never need write
// access") and consumed by state-guard and every role workflow's trust boundary. That
// guarantee should stay literally true — a read-only client cannot accidentally grow
// a write call through unrelated future edits — so writes live in a separate client
// (github-write-client.mjs) built on these same shared primitives instead.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const API_ROOT = "https://api.github.com";

export function requestHeaders(token, extra = {}) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "plimmerton-labs-engineering-automation",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

// Bot logins such as "github-actions[bot]" contain "[" and "]", which are not valid
// unencoded characters in a URL path segment (RFC 3986). Every dynamic path segment
// must be encoded -- see github-client.mjs history for the regression this guards
// against.
export function pathSegment(value) {
  return encodeURIComponent(String(value));
}

/**
 * Whether a fetch() failure is the DNS-resolution class of error that Node's
 * built-in fetch (undici) can hit in some agent sandbox environments even when the
 * network is otherwise fine -- confirmed live while building the agent-github CLI
 * (issue #145): plain `fetch("https://api.github.com")` failed with EAI_AGAIN in this
 * sandbox while `curl` against the same host succeeded immediately. This was already
 * worked around once, in scripts/github-app-token.mjs, but that fallback was never
 * applied to this shared module -- meaning every client built on it (github-client.mjs,
 * github-write-client.mjs, and anything built on top of them) inherited the same
 * fragility without anyone noticing, because nothing had exercised a live fetch()
 * call through this file in an affected sandbox until now.
 *
 * Pure and unit-tested on its own, separate from the actual curl invocation below,
 * which is I/O and not practically unit-testable without shelling out for real --
 * the same tradeoff scripts/github-app-token.mjs already made.
 */
export function isDnsResolutionFailure(error) {
  return error?.cause?.code === "EAI_AGAIN" || error?.cause?.code === "ENOTFOUND";
}

/**
 * Parses curl's raw stdout (body followed by a trailing "\n<status-code>", produced
 * by `--write-out "\n%{http_code}"`) and its dumped response headers (produced by
 * `--dump-header <file>`, CRLF-separated per RFC 7230) into the same shape callers
 * already get from a fetch() Response: ok/status/bodyText, plus the one header this
 * module actually reads (`link`, for pagination). Pure and unit-tested against
 * realistic captured curl output, independent of whether curl itself is available.
 */
export function parseCurlOutput(stdout, headerFileContent) {
  const lastNewline = stdout.lastIndexOf("\n");
  const bodyText = lastNewline === -1 ? "" : stdout.slice(0, lastNewline);
  const status = Number(stdout.slice(lastNewline + 1).trim());

  const linkLine = headerFileContent
    .split(/\r?\n/)
    .find((line) => /^link:/i.test(line));
  const linkHeader = linkLine ? linkLine.slice(linkLine.indexOf(":") + 1).trim() : null;

  return {
    ok: status >= 200 && status < 300,
    status,
    bodyText,
    linkHeader,
  };
}

function curlFallback(url, headers, options = {}) {
  const headerDir = mkdtempSync(join(tmpdir(), "github-http-"));
  const headerFile = join(headerDir, "headers");

  try {
    const args = ["--silent", "--show-error", "--dump-header", headerFile, "--write-out", "\n%{http_code}"];
    for (const [key, value] of Object.entries(headers)) {
      args.push("--header", `${key}: ${value}`);
    }
    if (options.method && options.method !== "GET") {
      args.push("--request", options.method);
    }
    if (options.body !== undefined) {
      args.push("--data", JSON.stringify(options.body));
    }
    args.push(url);

    const result = spawnSync("curl", args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`GitHub API request failed via curl fallback: ${result.stderr || result.stdout}`);
    }

    const headerFileContent = readFileSync(headerFile, "utf8");
    const { ok, status, bodyText, linkHeader } = parseCurlOutput(result.stdout, headerFileContent);

    return {
      ok,
      status,
      text: async () => bodyText,
      headers: { get: (name) => (name.toLowerCase() === "link" ? linkHeader : null) },
    };
  } finally {
    rmSync(headerDir, { recursive: true, force: true });
  }
}

/**
 * The one place every request in this module actually calls fetch(). Falls back to
 * curl, transparently, only for the DNS-resolution failure class -- a real HTTP error
 * response (404, 422, ...) is a normal, non-throwing fetch() result and never reaches
 * this catch at all, so tolerateMissing/status-code handling in get()/request() below
 * is completely unaffected by whether this fallback fires.
 */
async function doFetch(url, token, options = {}) {
  const headers = requestHeaders(token, options.body !== undefined ? { "Content-Type": "application/json" } : {});
  try {
    return await fetch(url, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (isDnsResolutionFailure(error)) {
      return curlFallback(url, headers, options);
    }
    throw error;
  }
}

async function parseBody(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function get(url, token) {
  const response = await doFetch(url, token);
  const body = await parseBody(response);

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

export async function getAllPages(url, token) {
  return getAllPagesEnveloped(url, token, (body) => body ?? []);
}

/**
 * Paginates a GitHub list endpoint whose response body is an object wrapping the
 * array, not the array itself -- e.g. `GET .../actions/runs` and
 * `GET .../actions/workflows/{id}/runs`, which return `{ total_count, workflow_runs:
 * [...] }`. `extractItems(body)` pulls the array out of each page's body.
 *
 * getAllPages (above) is the `extractItems = (body) => body` special case for the
 * more common flat-array endpoints (issues, comments, timeline, pulls). They share
 * this function rather than each endpoint hand-rolling its own Link-header
 * pagination loop.
 *
 * Added after a real bug (found in review, PR #124): listWorkflowRuns originally
 * called the flat-array getAllPages against an enveloped endpoint, so `results`
 * ended up as a one-element array containing the whole `{total_count,
 * workflow_runs}` object instead of the runs themselves -- confirmed against a live
 * captured API response, not just reasoned about.
 */
export async function getAllPagesEnveloped(url, token, extractItems) {
  let results = [];
  let next = url;

  while (next) {
    const response = await doFetch(next, token);
    const body = await parseBody(response);

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status} ${JSON.stringify(body)}`);
    }

    results = results.concat(extractItems(body));
    next = parseNextLink(response.headers.get("link"));
  }

  return results;
}

/**
 * Performs a write request (POST/PATCH/DELETE). Unlike `get`, a 404 on DELETE is
 * treated as success when `tolerateMissing` is set -- removing a label that is
 * already absent is the expected idempotent outcome, not an error, for callers like
 * removeLabel.
 */
export async function request(url, token, { method, body, tolerateMissing = false } = {}) {
  const response = await doFetch(url, token, { method, body });

  if (response.status === 404 && tolerateMissing) {
    await response.text();
    return null;
  }

  const responseBody = await parseBody(response);

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${JSON.stringify(responseBody)}`);
  }

  return responseBody;
}
