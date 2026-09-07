import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isStageLabel,
  extractLinkedIssueNumbers,
  planLinkedIssueResolution,
  deriveAgentIdentity,
  buildClaimMarker,
  hasClaimMarker,
  currentClaimOwner,
  buildLinkageWarningMarker,
  hasLinkageWarning,
  buildClaimComment,
  planClaim,
  planReadinessSync,
  planMergeCleanup,
} from "./issue-lifecycle-core.mjs";

// -- isStageLabel --------------------------------------------------------------

test("isStageLabel recognises stage:* labels and rejects everything else", () => {
  assert.equal(isStageLabel("stage:ready"), true);
  assert.equal(isStageLabel("enhancement"), false);
  assert.equal(isStageLabel("playbook-candidate"), false);
  assert.equal(isStageLabel(null), false);
  assert.equal(isStageLabel(undefined), false);
});

// -- extractLinkedIssueNumbers ---------------------------------------------------

const REPO = { owner: "Plimmerton-Labs", repo: "engineering-playbook" };

test("extractLinkedIssueNumbers finds a single closing-keyword reference", () => {
  assert.deepEqual(extractLinkedIssueNumbers("Closes #26", REPO), [26]);
  assert.deepEqual(extractLinkedIssueNumbers("This fixes #26.", REPO), [26]);
  assert.deepEqual(extractLinkedIssueNumbers("resolved #26", REPO), [26]);
});

test("extractLinkedIssueNumbers is case-insensitive and tolerant of a colon", () => {
  assert.deepEqual(extractLinkedIssueNumbers("CLOSES: #26", REPO), [26]);
  assert.deepEqual(extractLinkedIssueNumbers("Fix #26", REPO), [26]);
});

test("extractLinkedIssueNumbers dedupes repeated references to the same issue", () => {
  assert.deepEqual(extractLinkedIssueNumbers("Closes #26\n\nAlso closes #26 again.", REPO), [26]);
});

test("extractLinkedIssueNumbers finds multiple distinct references", () => {
  assert.deepEqual(
    extractLinkedIssueNumbers("Closes #26, closes #27", REPO).sort(),
    [26, 27],
  );
});

test("extractLinkedIssueNumbers ignores a bare issue reference without a keyword", () => {
  assert.deepEqual(extractLinkedIssueNumbers("See #26 for background.", REPO), []);
});

test("extractLinkedIssueNumbers returns nothing for an empty or missing body", () => {
  assert.deepEqual(extractLinkedIssueNumbers("", REPO), []);
  assert.deepEqual(extractLinkedIssueNumbers(null, REPO), []);
  assert.deepEqual(extractLinkedIssueNumbers(undefined, REPO), []);
});

test("extractLinkedIssueNumbers honours a matching explicit owner/repo#N reference", () => {
  assert.deepEqual(
    extractLinkedIssueNumbers("Closes Plimmerton-Labs/engineering-playbook#26", REPO),
    [26],
  );
});

test("extractLinkedIssueNumbers ignores a closing keyword pointed at a different repo", () => {
  assert.deepEqual(
    extractLinkedIssueNumbers("Closes Plimmerton-Labs/homebridge-ups-monitor#5", REPO),
    [],
  );
});

// -- planLinkedIssueResolution (AC6: fail safe) -----------------------------------

test("planLinkedIssueResolution resolves cleanly when exactly one issue is linked", () => {
  assert.deepEqual(planLinkedIssueResolution([26]), { ok: true, issueNumber: 26 });
});

test("planLinkedIssueResolution fails safe with no mutation when zero issues are linked", () => {
  const result = planLinkedIssueResolution([]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_linked_issue");
  assert.equal(typeof result.comment, "string");
});

test("planLinkedIssueResolution fails safe with no mutation when multiple issues are linked", () => {
  const result = planLinkedIssueResolution([26, 27]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ambiguous_linked_issue");
  assert.match(result.comment, /#26/);
  assert.match(result.comment, /#27/);
});

// -- deriveAgentIdentity -----------------------------------------------------------

test("deriveAgentIdentity reads the agent name from an agent/<agent>/<task> branch", () => {
  assert.equal(deriveAgentIdentity("agent/claude/issue-26-lifecycle-automation", "plimmerton-labs-ai-agents[bot]"), "claude");
  assert.equal(deriveAgentIdentity("agent/codex/workflow-state-learnings", "plimmerton-labs-ai-agents[bot]"), "codex");
});

test("deriveAgentIdentity falls back to the PR author login for non-agent branches", () => {
  assert.equal(deriveAgentIdentity("feature/xyz", "GodIsI"), "GodIsI");
  assert.equal(deriveAgentIdentity("fix/typo", "GodIsI"), "GodIsI");
  assert.equal(deriveAgentIdentity(undefined, "GodIsI"), "GodIsI");
});

// -- claim marker ------------------------------------------------------------------

test("hasClaimMarker matches only a comment carrying this exact PR's marker", () => {
  const comments = [{ body: "unrelated" }, { body: `Claimed by Claude.\n\n${buildClaimMarker(22)}` }];
  assert.equal(hasClaimMarker(comments, 22), true);
  assert.equal(hasClaimMarker(comments, 23), false);
  assert.equal(hasClaimMarker([], 22), false);
});

test("buildClaimComment includes agent identity, branch, scope, PR link, and the marker", () => {
  const body = buildClaimComment({
    agent: "claude",
    branch: "agent/claude/issue-26-lifecycle-automation",
    prUrl: "https://github.com/Plimmerton-Labs/engineering-playbook/pull/45",
    scope: "Implement lifecycle state automation",
    prNumber: 45,
  });
  assert.match(body, /claude/);
  assert.match(body, /agent\/claude\/issue-26-lifecycle-automation/);
  assert.match(body, /pull\/45/);
  assert.match(body, /Implement lifecycle state automation/);
  assert.match(body, new RegExp(buildClaimMarker(45).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// -- planClaim (AC1, AC2) -----------------------------------------------------------

test("planClaim: claim from stage:ready moves to stage:in-progress and requests a comment", () => {
  const plan = planClaim({ currentLabels: ["stage:ready", "enhancement"], alreadyClaimed: false });
  assert.deepEqual(plan, { addLabel: "stage:in-progress", removeLabels: ["stage:ready"], postComment: true });
});

test("planClaim: idempotent rerun with an existing claim marker is a no-op", () => {
  assert.equal(planClaim({ currentLabels: ["stage:ready"], alreadyClaimed: true }), null);
});

test("planClaim: does not regress an issue already at stage:in-progress or later", () => {
  assert.equal(planClaim({ currentLabels: ["stage:in-progress"], alreadyClaimed: false }), null);
  assert.equal(planClaim({ currentLabels: ["stage:in-review"], alreadyClaimed: false }), null);
});

test("planClaim: claiming from an unlabeled issue still adds stage:in-progress", () => {
  const plan = planClaim({ currentLabels: ["enhancement"], alreadyClaimed: false });
  assert.deepEqual(plan, { addLabel: "stage:in-progress", removeLabels: [], postComment: true });
});

// -- planReadinessSync (AC3) --------------------------------------------------------

test("planReadinessSync: draft PR keeps/moves the issue to stage:in-progress", () => {
  const plan = planReadinessSync({ isDraft: true, currentLabels: ["stage:ready"] });
  assert.deepEqual(plan, { addLabel: "stage:in-progress", removeLabels: ["stage:ready"] });
});

test("planReadinessSync: draft PR is a no-op when already stage:in-progress", () => {
  assert.equal(planReadinessSync({ isDraft: true, currentLabels: ["stage:in-progress"] }), null);
});

test("planReadinessSync: ready-for-review PR moves the issue to stage:in-review", () => {
  const plan = planReadinessSync({ isDraft: false, currentLabels: ["stage:in-progress"] });
  assert.deepEqual(plan, { addLabel: "stage:in-review", removeLabels: ["stage:in-progress"] });
});

test("planReadinessSync: ready-for-review PR is a no-op when already stage:in-review", () => {
  assert.equal(planReadinessSync({ isDraft: false, currentLabels: ["stage:in-review"] }), null);
});

test("planReadinessSync: never applies stage:in-review while the PR is draft", () => {
  const plan = planReadinessSync({ isDraft: true, currentLabels: ["stage:in-review"] });
  assert.equal(plan.addLabel, "stage:in-progress");
  assert.ok(!plan.removeLabels.includes("stage:in-progress"));
});

// -- planMergeCleanup (AC4, AC5) -----------------------------------------------------

test("planMergeCleanup: removes only stage:* labels and closes an open issue", () => {
  const plan = planMergeCleanup({
    issueState: "open",
    currentLabels: ["stage:in-review", "enhancement", "playbook-candidate"],
  });
  assert.deepEqual(plan, { closeIssue: true, removeLabels: ["stage:in-review"] });
});

test("planMergeCleanup: leaves non-stage labels like enhancement and playbook-candidate untouched", () => {
  const plan = planMergeCleanup({ issueState: "open", currentLabels: ["stage:in-review", "enhancement"] });
  assert.ok(!plan.removeLabels.includes("enhancement"));
});

test("planMergeCleanup: never re-adds a stage label and never adds stage:done", () => {
  const plan = planMergeCleanup({ issueState: "open", currentLabels: ["stage:in-review"] });
  assert.equal(plan.addLabel, undefined);
  assert.ok(!("stage:done" in plan));
});

test("planMergeCleanup: no-op when the issue is already closed with no stage labels left", () => {
  assert.equal(planMergeCleanup({ issueState: "closed", currentLabels: ["enhancement"] }), null);
});

test("planMergeCleanup: still strips stray stage labels even if the issue is already closed", () => {
  const plan = planMergeCleanup({ issueState: "closed", currentLabels: ["stage:in-review"] });
  assert.deepEqual(plan, { closeIssue: false, removeLabels: ["stage:in-review"] });
});


// -- currentClaimOwner / linkage warning marker (ownership + idempotency fixes) ----

test("currentClaimOwner returns null when an issue was never claimed", () => {
  assert.equal(currentClaimOwner([]), null);
  assert.equal(currentClaimOwner([{ body: "unrelated" }]), null);
});

test("currentClaimOwner returns the claiming PR number", () => {
  const comments = [{ body: "unrelated" }, { body: `Claimed by claude.\n\n${buildClaimMarker(48)}` }];
  assert.equal(currentClaimOwner(comments), 48);
});

test("currentClaimOwner returns the most recent claim when an issue was re-claimed after a reset", () => {
  const comments = [
    { body: `Claimed by codex.\n\n${buildClaimMarker(24)}` },
    { body: "some other comment in between" },
    { body: `Claimed by claude.\n\n${buildClaimMarker(48)}` },
  ];
  assert.equal(currentClaimOwner(comments), 48);
});

test("buildLinkageWarningMarker / hasLinkageWarning round-trip and are reason-specific", () => {
  const comments = [{ body: `some text\n\n${buildLinkageWarningMarker(48, "no_linked_issue")}` }];
  assert.equal(hasLinkageWarning(comments, 48, "no_linked_issue"), true);
  assert.equal(hasLinkageWarning(comments, 48, "ambiguous_linked_issue"), false);
  assert.equal(hasLinkageWarning(comments, 49, "no_linked_issue"), false);
  assert.equal(hasLinkageWarning([], 48, "no_linked_issue"), false);
});

test("planLinkedIssueResolution embeds a PR-specific marker in its fail-safe comments", () => {
  const noLinked = planLinkedIssueResolution([], 48);
  assert.match(noLinked.comment, new RegExp(buildLinkageWarningMarker(48, "no_linked_issue").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const ambiguous = planLinkedIssueResolution([26, 27], 48);
  assert.match(ambiguous.comment, new RegExp(buildLinkageWarningMarker(48, "ambiguous_linked_issue").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// -- planReadinessSync ownership check (P2 fix) -------------------------------------

test("planReadinessSync proceeds normally when the issue was never claimed (claimOwner null)", () => {
  const plan = planReadinessSync({ isDraft: false, currentLabels: ["stage:in-progress"], prNumber: 48, claimOwner: null });
  assert.deepEqual(plan, { addLabel: "stage:in-review", removeLabels: ["stage:in-progress"] });
});

test("planReadinessSync proceeds normally when this PR is the recognised claim owner", () => {
  const plan = planReadinessSync({ isDraft: false, currentLabels: ["stage:in-progress"], prNumber: 48, claimOwner: 48 });
  assert.deepEqual(plan, { addLabel: "stage:in-review", removeLabels: ["stage:in-progress"] });
});

test("planReadinessSync blocks when a different PR owns the claim (does not regress the real owner's stage)", () => {
  const plan = planReadinessSync({ isDraft: true, currentLabels: ["stage:in-review"], prNumber: 200, claimOwner: 100 });
  assert.deepEqual(plan, { blocked: true, reason: "claimed_by_other_pr", owner: 100 });
});

test("planReadinessSync remains backward compatible when prNumber/claimOwner are omitted entirely", () => {
  const plan = planReadinessSync({ isDraft: false, currentLabels: ["stage:in-progress"] });
  assert.deepEqual(plan, { addLabel: "stage:in-review", removeLabels: ["stage:in-progress"] });
});

// -- planMergeCleanup ownership check (P2 fix) --------------------------------------

test("planMergeCleanup proceeds normally when this PR is the recognised claim owner", () => {
  const plan = planMergeCleanup({ issueState: "open", currentLabels: ["stage:in-review"], prNumber: 48, claimOwner: 48 });
  assert.deepEqual(plan, { closeIssue: true, removeLabels: ["stage:in-review"] });
});

test("planMergeCleanup blocks when a different PR (not the claim owner) merges with a stray closing keyword", () => {
  const plan = planMergeCleanup({ issueState: "open", currentLabels: ["stage:in-review"], prNumber: 200, claimOwner: 100 });
  assert.deepEqual(plan, { blocked: true, reason: "claimed_by_other_pr", owner: 100 });
});

test("planMergeCleanup skips the ownership check entirely for the issues-closed fallback path (no prNumber/claimOwner)", () => {
  const plan = planMergeCleanup({ issueState: "closed", currentLabels: ["stage:in-review"] });
  assert.deepEqual(plan, { closeIssue: false, removeLabels: ["stage:in-review"] });
});
