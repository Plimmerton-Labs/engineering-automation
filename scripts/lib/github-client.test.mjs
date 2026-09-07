import { test } from "node:test";
import assert from "node:assert/strict";
import { createGithubClient } from "./github-client.mjs";

// Regression test for a real bug found while running the integration test in CI:
// bot logins such as "github-actions[bot]" contain "[" and "]", which must be
// percent-encoded in a URL path segment. An earlier version of this client
// interpolated the username unencoded, which reached GitHub's API mangled and
// produced an uncaught exception instead of a clean permission lookup.

function stubFetch(fixture) {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return { ok: true, text: async () => JSON.stringify(fixture), headers: { get: () => null } };
  };
  return {
    urls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("getCollaboratorPermission percent-encodes usernames containing brackets", async () => {
  const client = createGithubClient("fake-token");
  const stub = stubFetch({ permission: "none" });
  try {
    await client.getCollaboratorPermission("Plimmerton-Labs", "engineering-playbook", "github-actions[bot]");
  } finally {
    stub.restore();
  }

  assert.equal(
    stub.urls[0],
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/collaborators/github-actions%5Bbot%5D/permission",
  );
  assert.doesNotMatch(stub.urls[0], /\[bot\]/, "the raw, unencoded brackets must not appear in the URL");
});

test("listIssueTimeline and listIssueComments also encode owner/repo/issueNumber", async () => {
  const client = createGithubClient("fake-token");
  const stub = stubFetch([]);
  try {
    await client.listIssueTimeline("Plimmerton-Labs", "engineering-playbook", 27);
    await client.listIssueComments("Plimmerton-Labs", "engineering-playbook", 27);
  } finally {
    stub.restore();
  }

  assert.equal(
    stub.urls[0],
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/issues/27/timeline?per_page=100",
  );
  assert.equal(
    stub.urls[1],
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/issues/27/comments?per_page=100",
  );
});

test("listPullRequestsForBase requests state=all sorted by created desc for the given base", async () => {
  const client = createGithubClient("fake-token");
  const stub = stubFetch([]);
  try {
    await client.listPullRequestsForBase("Plimmerton-Labs", "engineering-playbook", "develop");
  } finally {
    stub.restore();
  }

  assert.equal(
    stub.urls[0],
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/pulls?base=develop&state=all&sort=created&direction=desc&per_page=100",
  );
});

test("listWorkflowRuns accepts a workflow filename, not just a numeric id", async () => {
  const client = createGithubClient("fake-token");
  const stub = stubFetch({ total_count: 0, workflow_runs: [] });
  try {
    await client.listWorkflowRuns("Plimmerton-Labs", "engineering-playbook", "issue-lifecycle-sync.yml");
  } finally {
    stub.restore();
  }

  assert.equal(
    stub.urls[0],
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/actions/workflows/issue-lifecycle-sync.yml/runs?per_page=100",
  );
});

// Regression test for a real bug found in review (PR #124): this endpoint's response
// body is { total_count, workflow_runs: [...] }, not a flat array like the other list
// endpoints this client wraps. Using the flat-array paginator against it silently
// produced a one-element array containing the whole envelope object instead of the
// runs -- confirmed against a live captured GitHub API response, not just reasoned
// about. This test asserts on the *returned value*, not just the request URL, which
// is exactly what the original test omitted and how the bug shipped unnoticed.
test("listWorkflowRuns unwraps the enveloped { total_count, workflow_runs } response into a flat array", async () => {
  const client = createGithubClient("fake-token");
  const stub = stubFetch({
    total_count: 2,
    workflow_runs: [
      { id: 1, event: "pull_request_target", created_at: "2026-08-18T00:00:00Z" },
      { id: 2, event: "issues", created_at: "2026-08-17T00:00:00Z" },
    ],
  });
  let runs;
  try {
    runs = await client.listWorkflowRuns("Plimmerton-Labs", "engineering-playbook", "issue-lifecycle-sync.yml");
  } finally {
    stub.restore();
  }

  assert.ok(Array.isArray(runs));
  assert.deepEqual(
    runs.map((r) => r.id),
    [1, 2],
  );
});

test("listOpenIssuesByLabel percent-encodes the label and filters state=open", async () => {
  const client = createGithubClient("fake-token");
  const stub = stubFetch([]);
  try {
    await client.listOpenIssuesByLabel("Plimmerton-Labs", "engineering-playbook", "automation-alert");
  } finally {
    stub.restore();
  }

  assert.equal(
    stub.urls[0],
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/issues?state=open&labels=automation-alert&per_page=100",
  );
});

test("drift reads use default repository, content, labels, and all-issues endpoints", async () => {
  const client = createGithubClient("fake-token");
  const stub = stubFetch([]);
  try {
    await client.getRepository("Plimmerton-Labs", "demo");
    await client.getRepositoryContent("Plimmerton-Labs", "demo", ".github/workflows/check.yml", "main");
    await client.listRepositoryLabels("Plimmerton-Labs", "demo");
    await client.listRepositoryIssues("Plimmerton-Labs", "demo");
  } finally {
    stub.restore();
  }
  assert.deepEqual(stub.urls, [
    "https://api.github.com/repos/Plimmerton-Labs/demo",
    "https://api.github.com/repos/Plimmerton-Labs/demo/contents/.github/workflows/check.yml?ref=main",
    "https://api.github.com/repos/Plimmerton-Labs/demo/labels?per_page=100",
    "https://api.github.com/repos/Plimmerton-Labs/demo/issues?state=all&per_page=100",
  ]);
});
