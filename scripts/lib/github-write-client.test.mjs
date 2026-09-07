import { test } from "node:test";
import assert from "node:assert/strict";
import { createGithubWriteClient } from "./github-write-client.mjs";

function stubFetch(responses) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let i = 0;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : undefined });
    const fixture = Array.isArray(responses) ? responses[Math.min(i, responses.length - 1)] : responses;
    i += 1;
    return {
      ok: fixture.ok ?? true,
      status: fixture.status ?? 200,
      text: async () => JSON.stringify(fixture.body ?? {}),
      headers: { get: () => null },
    };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("addLabels posts to the issues labels endpoint with the label array", async () => {
  const client = createGithubWriteClient("fake-token");
  const stub = stubFetch({ body: [{ name: "stage:in-progress" }] });
  try {
    await client.addLabels("Plimmerton-Labs", "engineering-playbook", 26, ["stage:in-progress"]);
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls[0].method, "POST");
  assert.equal(
    stub.calls[0].url,
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/issues/26/labels",
  );
  assert.deepEqual(stub.calls[0].body, { labels: ["stage:in-progress"] });
});

test("repository label remediation creates and updates only named shared labels", async () => {
  const client = createGithubWriteClient("fake-token");
  const stub = stubFetch([{ body: { name: "new" } }, { body: { name: "existing" } }]);
  try {
    await client.createRepositoryLabel("Plimmerton-Labs", "demo", { name: "new", color: "ffffff", description: "New" });
    await client.updateRepositoryLabel("Plimmerton-Labs", "demo", "existing", { name: "existing", color: "000000", description: "Updated" });
  } finally {
    stub.restore();
  }
  assert.deepEqual(stub.calls.map((call) => [call.method, call.url]), [
    ["POST", "https://api.github.com/repos/Plimmerton-Labs/demo/labels"],
    ["PATCH", "https://api.github.com/repos/Plimmerton-Labs/demo/labels/existing"],
  ]);
});

test("removeLabel percent-encodes the label name and DELETEs the exact label sub-resource", async () => {
  const client = createGithubWriteClient("fake-token");
  const stub = stubFetch({ body: {} });
  try {
    await client.removeLabel("Plimmerton-Labs", "engineering-playbook", 26, "stage:in-review");
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls[0].method, "DELETE");
  assert.equal(
    stub.calls[0].url,
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/issues/26/labels/stage%3Ain-review",
  );
});

test("removeLabel tolerates a 404 (label already absent) as a successful no-op", async () => {
  const client = createGithubWriteClient("fake-token");
  const stub = stubFetch({ ok: false, status: 404, body: { message: "Label does not exist" } });
  try {
    const result = await client.removeLabel("Plimmerton-Labs", "engineering-playbook", 26, "stage:ready");
    assert.equal(result, null);
  } finally {
    stub.restore();
  }
});

test("createIssueComment posts body as JSON to the comments endpoint (works for PRs too)", async () => {
  const client = createGithubWriteClient("fake-token");
  const stub = stubFetch({ body: { id: 1 } });
  try {
    await client.createIssueComment("Plimmerton-Labs", "engineering-playbook", 24, "hello world");
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls[0].method, "POST");
  assert.equal(
    stub.calls[0].url,
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/issues/24/comments",
  );
  assert.deepEqual(stub.calls[0].body, { body: "hello world" });
});

test("closeIssue PATCHes state=closed on the issue itself", async () => {
  const client = createGithubWriteClient("fake-token");
  const stub = stubFetch({ body: { state: "closed" } });
  try {
    await client.closeIssue("Plimmerton-Labs", "engineering-playbook", 26);
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls[0].method, "PATCH");
  assert.equal(
    stub.calls[0].url,
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/issues/26",
  );
  assert.deepEqual(stub.calls[0].body, { state: "closed" });
});

test("addLabels throws on a genuine non-404 failure", async () => {
  const client = createGithubWriteClient("fake-token");
  const stub = stubFetch({ ok: false, status: 422, body: { message: "Validation Failed" } });
  try {
    await assert.rejects(() => client.addLabels("Plimmerton-Labs", "engineering-playbook", 26, ["bogus"]));
  } finally {
    stub.restore();
  }
});

test("createIssue POSTs title, body, and labels to the issues endpoint", async () => {
  const client = createGithubWriteClient("fake-token");
  const stub = stubFetch({ body: { number: 123 } });
  try {
    await client.createIssue("Plimmerton-Labs", "engineering-playbook", {
      title: "Liveness gap",
      body: "details",
      labels: ["bug", "automation-alert"],
    });
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls[0].method, "POST");
  assert.equal(
    stub.calls[0].url,
    "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/issues",
  );
  assert.deepEqual(stub.calls[0].body, { title: "Liveness gap", body: "details", labels: ["bug", "automation-alert"] });
});

test("updateIssue PATCHes durable report body and state", async () => {
  const client = createGithubWriteClient("fake-token");
  const stub = stubFetch({ body: { number: 152, state: "open" } });
  try {
    await client.updateIssue("Plimmerton-Labs", "engineering-playbook", 152, { body: "report", state: "open" });
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls[0].method, "PATCH");
  assert.equal(stub.calls[0].url, "https://api.github.com/repos/Plimmerton-Labs/engineering-playbook/issues/152");
  assert.deepEqual(stub.calls[0].body, { body: "report", state: "open" });
});
