#!/usr/bin/env node

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const requiredEnv = [
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
];

// Git committer identity for the Plimmerton Labs AI Agents GitHub App.
// Use this when creating commits via the GitHub API so attribution is correct.
// Format follows GitHub's convention: {bot-user-id}+{app-slug}[bot]@users.noreply.github.com
export const BOT_COMMITTER = {
  name: "Plimmerton Labs AI Agents",
  email: "296834291+plimmerton-labs-ai-agents[bot]@users.noreply.github.com",
};

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function usage() {
  console.log(`Usage: node scripts/github-app-token.mjs [--json]

Required environment:
  GITHUB_APP_ID
  GITHUB_APP_INSTALLATION_ID
  GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY

Output:
  Prints a short-lived GitHub App installation token to stdout.
  Use --json to include the expiry timestamp and permissions.
`);
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function getPrivateKey() {
  if (process.env.GITHUB_APP_PRIVATE_KEY) {
    return process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  }

  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (!keyPath) {
    throw new Error(
      "Missing required environment variable: GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY",
    );
  }

  return readFile(keyPath, "utf8");
}

function createJwt(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  };

  const unsigned = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(privateKey, "base64url");

  return `${unsigned}.${signature}`;
}

async function githubRequestFetch(url, token, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "plimmerton-labs-ai-agents",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
}

function githubRequestCurl(url, token, options = {}) {
  const args = [
    "--silent", "--show-error", "--fail-with-body",
    "--header", `Accept: application/vnd.github+json`,
    "--header", `Authorization: Bearer ${token}`,
    "--header", `User-Agent: plimmerton-labs-ai-agents`,
    "--header", `X-GitHub-Api-Version: 2022-11-28`,
  ];

  if (options.method && options.method !== "GET") {
    args.push("--request", options.method);
  }

  if (options.body) {
    args.push("--header", "Content-Type: application/json");
    args.push("--data", JSON.stringify(options.body));
  }

  args.push(url);

  const result = spawnSync("curl", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`GitHub API request failed via curl: ${result.stderr || result.stdout}`);
  }

  const text = result.stdout;
  return text ? JSON.parse(text) : {};
}

async function githubRequest(path, token, options = {}) {
  const url = `https://api.github.com${path}`;
  try {
    return await githubRequestFetch(url, token, options);
  } catch (error) {
    // Node's fetch (undici) can fail DNS resolution in some agent sandbox environments
    // even when curl succeeds. Fall back to curl if it's available.
    if (error.cause?.code === "EAI_AGAIN" || error.cause?.code === "ENOTFOUND") {
      return githubRequestCurl(url, token, options);
    }
    throw error;
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  for (const name of requiredEnv) {
    getRequiredEnv(name);
  }

  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const privateKey = await getPrivateKey();
  const jwt = createJwt(appId, privateKey);

  const tokenResponse = await githubRequest(
    `/app/installations/${installationId}/access_tokens`,
    jwt,
    { method: "POST" },
  );

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({
      token: tokenResponse.token,
      expires_at: tokenResponse.expires_at,
      permissions: tokenResponse.permissions,
      repositories: tokenResponse.repositories?.map((repo) => repo.full_name),
    }, null, 2));
    return;
  }

  console.log(tokenResponse.token);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
