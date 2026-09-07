import { test } from "node:test";
import assert from "node:assert/strict";
import { isDnsResolutionFailure, parseCurlOutput } from "./github-http.mjs";

test("isDnsResolutionFailure is true for EAI_AGAIN, the error actually observed in this sandbox", () => {
  const error = new Error("fetch failed");
  error.cause = { code: "EAI_AGAIN" };
  assert.equal(isDnsResolutionFailure(error), true);
});

test("isDnsResolutionFailure is true for ENOTFOUND", () => {
  const error = new Error("fetch failed");
  error.cause = { code: "ENOTFOUND" };
  assert.equal(isDnsResolutionFailure(error), true);
});

test("isDnsResolutionFailure is false for an unrelated error, including one with no cause at all", () => {
  assert.equal(isDnsResolutionFailure(new Error("boom")), false);
  const error = new Error("fetch failed");
  error.cause = { code: "ECONNRESET" };
  assert.equal(isDnsResolutionFailure(error), false);
});

test("parseCurlOutput splits body from the trailing status code and reads the link header", () => {
  const stdout = '{"ok":true}\n200';
  const headerFileContent = [
    "HTTP/2 200",
    "content-type: application/json; charset=utf-8",
    '<https://api.github.com/repos/x/y/issues?page=2>; rel="next", <https://api.github.com/repos/x/y/issues?page=5>; rel="last"'.replace(/^/, "link: "),
    "",
  ].join("\r\n");

  const result = parseCurlOutput(stdout, headerFileContent);

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.bodyText, '{"ok":true}');
  assert.match(result.linkHeader, /rel="next"/);
});

test("parseCurlOutput reports a non-2xx status as not ok, matching fetch()'s response.ok semantics", () => {
  const stdout = '{"message":"Validation Failed"}\n422';
  const result = parseCurlOutput(stdout, "HTTP/2 422\r\ncontent-type: application/json\r\n");

  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(result.bodyText, '{"message":"Validation Failed"}');
});

test("parseCurlOutput returns null linkHeader when no link header was present", () => {
  const result = parseCurlOutput('{}\n200', "HTTP/2 200\r\ncontent-type: application/json\r\n");
  assert.equal(result.linkHeader, null);
});

test("parseCurlOutput handles an empty body (e.g. a 204 or a DELETE response)", () => {
  const result = parseCurlOutput("\n204", "HTTP/2 204\r\n");
  assert.equal(result.bodyText, "");
  assert.equal(result.status, 204);
  assert.equal(result.ok, true);
});
