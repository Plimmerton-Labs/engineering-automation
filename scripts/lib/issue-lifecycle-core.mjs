// Pure decision logic for the issue-lifecycle-sync automation (issue #26,
// WORKFLOW.md's lifecycle invariants). Every function here is a plain data-in/plan-out
// transform with no I/O -- the orchestrator (scripts/issue-lifecycle-sync-run.mjs)
// performs the actual API calls the plans describe. This mirrors the split already
// established by preflight-verify-core.mjs / index.mjs: keep the decisions
// unit-testable without a live GitHub API, keep the wiring thin.
//
// SCOPE BOUNDARY -- read this before adding an authority check here.
// This module implements WORKFLOW.md's statement that "Labels are therefore treated
// as display, not authority." It is bookkeeping, not a security gate: it does not
// verify that the actor claiming an issue is permitted to, and it must not be asked
// to. That responsibility belongs to state-guard and the tested preflight verifier
// (issue #21, preflight-verify-core.mjs). See docs/decisions/0003-issue-lifecycle-sync-design.md
// for why this automation sits outside that trust boundary entirely (it reacts to
// native `pull_request`/`issues` events, not `workflow_dispatch`, and never mints
// privileged credentials).

const STAGE_LABEL_PATTERN = /^stage:/;

export function isStageLabel(name) {
  return typeof name === "string" && STAGE_LABEL_PATTERN.test(name);
}

// -- Linked issue resolution ------------------------------------------------------

// GitHub's own closing-keyword grammar: a keyword immediately followed by a same- or
// cross-repo issue reference. See
// https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
const CLOSING_KEYWORD_PATTERN = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:([\w.-]+\/[\w.-]+)#|#)(\d+)/gi;

/**
 * Extracts issue numbers referenced with a GitHub closing keyword in a PR body,
 * restricted to the given owner/repo. Cross-repo references to a *different*
 * repo are deliberately ignored rather than resolved -- this automation only ever
 * mutates issues in the repo the workflow is running in, and a cross-repo reference
 * is out of scope, not an error.
 */
export function extractLinkedIssueNumbers(prBody, { owner, repo }) {
  if (!prBody) return [];
  const expectedRepo = `${owner}/${repo}`.toLowerCase();
  const found = new Set();

  for (const match of prBody.matchAll(CLOSING_KEYWORD_PATTERN)) {
    const [, , crossRepo, issueNumber] = match;
    if (crossRepo && crossRepo.toLowerCase() !== expectedRepo) continue;
    found.add(Number(issueNumber));
  }

  return [...found];
}

/** Marker embedded in a linkage fail-safe comment so re-firing the same PR event doesn't repost it. */
export function buildLinkageWarningMarker(prNumber, reason) {
  return `<!-- issue-lifecycle:linkage-warning pr=${prNumber} reason=${reason} -->`;
}

/** Checks whether this exact PR has already been warned for this exact reason. */
export function hasLinkageWarning(comments, prNumber, reason) {
  const marker = buildLinkageWarningMarker(prNumber, reason);
  return (comments ?? []).some((c) => (c.body ?? "").includes(marker));
}

/**
 * Resolves a set of candidate linked issue numbers to exactly one, or explains why
 * it can't -- this is AC6's "fails safe" requirement made independently testable.
 * The caller (orchestrator) posts `comment` on the PR itself and touches no issue.
 * `comment` embeds a marker (buildLinkageWarningMarker) so the orchestrator can avoid
 * reposting it on every subsequent event for a PR that never fixes its linkage (a
 * long-lived draft PR toggling ready/draft several times would otherwise accumulate
 * one near-duplicate warning per event).
 */
export function planLinkedIssueResolution(issueNumbers, prNumber) {
  const unique = [...new Set(issueNumbers)];

  if (unique.length === 1) {
    return { ok: true, issueNumber: unique[0] };
  }

  if (unique.length === 0) {
    const reason = "no_linked_issue";
    return {
      ok: false,
      reason,
      comment:
        "issue-lifecycle-sync: no issue found linked with a closing keyword (e.g. `Closes #123`) in this " +
        "PR's description, so no issue stage was changed. If this PR should drive an issue's lifecycle, " +
        "add a closing keyword referencing it.\n\n" +
        buildLinkageWarningMarker(prNumber, reason),
    };
  }

  const reason = "ambiguous_linked_issue";
  return {
    ok: false,
    reason,
    comment:
      "issue-lifecycle-sync: found more than one issue linked with a closing keyword " +
      `(${unique.map((n) => `#${n}`).join(", ")}), so no issue stage was changed to avoid guessing which one ` +
      "this PR is really for. Reference exactly one issue with a closing keyword if this PR should drive an " +
      "issue's lifecycle.\n\n" +
      buildLinkageWarningMarker(prNumber, reason),
  };
}

// -- Agent identity -----------------------------------------------------------------

// All AI agents share one GitHub App identity (Plimmerton Labs AI Agents, per
// AGENTS.md), so the PR author login alone cannot distinguish Claude from Codex from
// a human. AGENTS.md's own branch-naming convention (agent/<agent>/<task>) is the
// only structured, reliably-present signal for which agent is acting -- so that is
// what this reads, falling back to the PR author login for human-authored branches.
const AGENT_BRANCH_PATTERN = /^agent\/([^/]+)\//;

export function deriveAgentIdentity(branchRef, fallbackLogin) {
  const match = AGENT_BRANCH_PATTERN.exec(branchRef ?? "");
  return match ? match[1] : fallbackLogin;
}

// -- Claim comment + idempotency marker ---------------------------------------------

const CLAIM_MARKER_PATTERN = /<!--\s*issue-lifecycle:claim\s+pr=(\d+)\s*-->/;

export function buildClaimMarker(prNumber) {
  return `<!-- issue-lifecycle:claim pr=${prNumber} -->`;
}

/** Checks whether a claim for this exact PR has already been posted on the issue. */
export function hasClaimMarker(comments, prNumber) {
  const marker = buildClaimMarker(prNumber);
  return (comments ?? []).some((c) => (c.body ?? "").includes(marker));
}

/**
 * Returns the PR number of the most recent claim on an issue, or null if it has
 * never been claimed. Used to stop a *different*, unclaimed PR from moving or
 * closing an issue that another PR already owns (see planReadinessSync and
 * planMergeCleanup below) -- claim markers can only ever grow more recent, so the
 * last one in comment order is authoritative if an issue was ever re-claimed after
 * a reset back to stage:ready.
 */
export function currentClaimOwner(comments) {
  const owners = (comments ?? [])
    .map((c) => CLAIM_MARKER_PATTERN.exec(c.body ?? ""))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  return owners.length > 0 ? owners[owners.length - 1] : null;
}

export function buildClaimComment({ agent, branch, prUrl, scope, prNumber }) {
  return [
    `Claimed by ${agent}.`,
    "",
    `- Agent: ${agent}`,
    `- Branch: \`${branch}\``,
    `- Scope: ${scope}`,
    `- PR: ${prUrl}`,
    "",
    buildClaimMarker(prNumber),
  ].join("\n");
}

// -- Stage transition plans -----------------------------------------------------

// An issue at or beyond stage:in-progress has already been claimed; claiming again
// (absent the idempotency marker, handled separately) would be a regression, not a
// forward move, so planClaim only fires from stage:ready/refining/triage/(no stage).
const ALREADY_CLAIMED_STAGES = new Set(["stage:in-progress", "stage:in-review"]);

/**
 * Plans the "worker claims work" transition (WORKFLOW.md: "Claiming work must be
 * visible in the issue record"). Returns null if there is nothing to do -- either a
 * claim marker for this exact PR already exists (AC2: idempotent rerun), or the issue
 * is already at or past stage:in-progress (defensive: never regress a later stage).
 */
export function planClaim({ currentLabels, alreadyClaimed }) {
  if (alreadyClaimed) return null;
  if (currentLabels.some((label) => ALREADY_CLAIMED_STAGES.has(label))) return null;

  return {
    addLabel: "stage:in-progress",
    removeLabels: currentLabels.filter(isStageLabel),
    postComment: true,
  };
}

/**
 * Plans the draft/ready PR <-> issue stage sync (WORKFLOW.md: "Draft pull requests
 * are still execution state" / "stage:in-review means human-reviewable"). Returns
 * null if the issue's stage already matches the target, preserving the
 * one-stage-label invariant without unnecessary label churn.
 *
 * `claimOwner` is the PR number returned by currentClaimOwner (or null if never
 * claimed) and `prNumber` is the PR driving *this* event. If the issue is currently
 * claimed by a *different* PR, this returns a blocked result instead of mutating --
 * without this check, a second, unrelated PR that happens to also reference the same
 * issue (e.g. opened as a draft after the real owner's PR is already ready for
 * review) would silently regress the issue's stage out from under the actual owner.
 * A missing claimOwner (null) means the issue was never claimed through this
 * automation -- nothing to protect against, so sync proceeds normally.
 */
export function planReadinessSync({ isDraft, currentLabels, prNumber, claimOwner }) {
  if (claimOwner !== null && claimOwner !== undefined && prNumber !== undefined && claimOwner !== prNumber) {
    return { blocked: true, reason: "claimed_by_other_pr", owner: claimOwner };
  }

  const target = isDraft ? "stage:in-progress" : "stage:in-review";
  const currentStageLabels = currentLabels.filter(isStageLabel);

  if (currentStageLabels.length === 1 && currentStageLabels[0] === target) {
    return null;
  }

  return {
    addLabel: target,
    removeLabels: currentStageLabels.filter((label) => label !== target),
  };
}

/**
 * Plans merge cleanup (WORKFLOW.md: "When the linked PR merges, merge automation
 * closes the issue and removes any stage:* labels so closed issue state remains the
 * source of truth"). This repo's branch model merges PRs into `develop` first, not
 * the repository's default branch, so GitHub's native closing-keyword auto-close
 * does not fire on that merge (confirmed empirically: issue #21 stayed open across
 * PR #22's merge into develop and required a manual close). Closing the issue here,
 * rather than only verifying GitHub already did it, is what makes cleanup actually
 * run in this repo's real flow -- see ADR 0003. Closing an already-closed issue is a
 * harmless no-op per the GitHub API, so this is safe to call from either the
 * pull_request-merged path or the issues-closed fallback path without double effects.
 *
 * `prNumber`/`claimOwner` are only passed from the pull_request-merged path, where a
 * *different* PR than the recognised claim owner merging with a stray closing
 * keyword must not be allowed to close someone else's still-unfinished work. The
 * issues-closed fallback path (a human or a future default-branch auto-close
 * directly closing the issue) omits both -- a direct close is authoritative
 * regardless of which PR, if any, is recorded as the claim owner.
 */
export function planMergeCleanup({ issueState, currentLabels, prNumber, claimOwner }) {
  if (claimOwner !== null && claimOwner !== undefined && prNumber !== undefined && claimOwner !== prNumber) {
    return { blocked: true, reason: "claimed_by_other_pr", owner: claimOwner };
  }

  const stageLabels = currentLabels.filter(isStageLabel);
  const needsClose = issueState !== "closed";

  if (!needsClose && stageLabels.length === 0) return null;

  return { closeIssue: needsClose, removeLabels: stageLabels };
}
