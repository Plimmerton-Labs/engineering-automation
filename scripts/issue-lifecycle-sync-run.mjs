#!/usr/bin/env node
// Entry point for the issue-lifecycle-sync GitHub Action workflow (originally
// engineering-playbook issue #26; the implementation now lives here -- see this
// repo's ADR-0002 for why).
//
// Invoked from ../../.github/actions/issue-lifecycle-sync/action.yml, a composite
// action that exists so other repositories can consume this via a pinned,
// immutable release tag (`uses: .../issue-lifecycle-sync@vX.Y.Z`) rather than
// each caller vendoring its own copy of this script. The script itself stays a
// plain Node entry point rather than parsing `with:` inputs: it reads the full
// event payload from $GITHUB_EVENT_PATH (the standard mechanism every Actions
// runtime provides regardless of language) instead of threading a dozen
// individual inputs through the workflow file.
//
// All decision-making lives in scripts/lib/issue-lifecycle-core.mjs and is unit
// tested there without any live API calls. This file is intentionally thin glue:
// read the event, call the pure planners, execute what they return via the write
// client. See engineering-playbook's docs/decisions/0003-issue-lifecycle-sync-design.md
// for the design rationale (why merge cleanup actively closes the issue, why agent
// identity comes from the branch name, why this sits outside the preflight-verify
// trust boundary, why readiness sync and merge cleanup check claim ownership, and
// why the real workflow triggers on pull_request_target rather than pull_request)
// -- that rationale is unchanged by the relocation, so it isn't repeated here.
import { readFileSync } from "node:fs";
import { createGithubClient } from "./lib/github-client.mjs";
import { createGithubWriteClient } from "./lib/github-write-client.mjs";
import {
  extractLinkedIssueNumbers,
  planLinkedIssueResolution,
  deriveAgentIdentity,
  buildClaimComment,
  hasClaimMarker,
  currentClaimOwner,
  hasLinkageWarning,
  planClaim,
  planReadinessSync,
  planMergeCleanup,
  isStageLabel,
} from "./lib/issue-lifecycle-core.mjs";

function labelNames(issueOrPr) {
  return (issueOrPr.labels ?? []).map((label) => (typeof label === "string" ? label : label.name));
}

async function applyLabelPlan(writeClient, owner, repo, issueNumber, plan) {
  for (const label of plan.removeLabels) {
    await writeClient.removeLabel(owner, repo, issueNumber, label);
  }
  if (plan.addLabel) {
    await writeClient.addLabels(owner, repo, issueNumber, [plan.addLabel]);
  }
}

/**
 * Posts a warning comment on the PR, but only once per (PR, reason) pair -- reused
 * for both "linked issue is ambiguous/missing" (AC6) and "issue is claimed by a
 * different PR" (ownership check) so neither accumulates a duplicate comment every
 * time a long-lived PR toggles draft/ready or is reopened.
 */
async function postWarningOnce({ readClient, writeClient, owner, repo, pr, reason, comment }) {
  const prComments = await readClient.listIssueComments(owner, repo, pr.number);
  if (hasLinkageWarning(prComments, pr.number, reason)) {
    console.log(`issue-lifecycle-sync: PR #${pr.number} already warned for "${reason}"; not reposting.`);
    return;
  }
  await writeClient.createIssueComment(owner, repo, pr.number, comment);
}

async function resolveLinkedIssue({ readClient, writeClient, owner, repo, pr }) {
  const candidates = extractLinkedIssueNumbers(pr.body, { owner, repo });
  const resolution = planLinkedIssueResolution(candidates, pr.number);

  if (!resolution.ok) {
    console.log(`issue-lifecycle-sync: ${resolution.reason} for PR #${pr.number}; commenting (if not already) and skipping.`);
    await postWarningOnce({ readClient, writeClient, owner, repo, pr, reason: resolution.reason, comment: resolution.comment });
    return null;
  }

  return resolution.issueNumber;
}

async function handlePullRequestSync({ readClient, writeClient, owner, repo, pr }) {
  const issueNumber = await resolveLinkedIssue({ readClient, writeClient, owner, repo, pr });
  if (issueNumber === null) return;

  const issue = await readClient.getIssue(owner, repo, issueNumber);
  const comments = await readClient.listIssueComments(owner, repo, issueNumber);
  const alreadyClaimed = hasClaimMarker(comments, pr.number);
  const claimOwnerBeforeClaim = currentClaimOwner(comments);

  let currentLabels = labelNames(issue);
  const claimPlan = planClaim({ currentLabels, alreadyClaimed });

  if (claimPlan) {
    console.log(`issue-lifecycle-sync: claiming issue #${issueNumber} for PR #${pr.number}.`);
    await applyLabelPlan(writeClient, owner, repo, issueNumber, claimPlan);

    const agent = deriveAgentIdentity(pr.head?.ref, pr.user?.login ?? "unknown");
    const comment = buildClaimComment({
      agent,
      branch: pr.head?.ref ?? "(unknown branch)",
      prUrl: pr.html_url,
      scope: pr.title,
      prNumber: pr.number,
    });
    await writeClient.createIssueComment(owner, repo, issueNumber, comment);

    // Reflect the label change locally so the readiness-sync plan below sees the
    // post-claim state rather than stale pre-claim labels.
    currentLabels = [...currentLabels.filter((label) => !isStageLabel(label)), claimPlan.addLabel];
  } else {
    console.log(`issue-lifecycle-sync: issue #${issueNumber} already claimed for PR #${pr.number}; no claim action.`);
  }

  // A fresh claim just now makes this PR the owner going forward, regardless of who
  // (if anyone) owned it before. Otherwise, whatever currentClaimOwner found from
  // the issue's comment history stands -- which may be a *different* PR than this
  // one, in which case readiness sync below must not touch the issue.
  const effectiveClaimOwner = claimPlan ? pr.number : claimOwnerBeforeClaim;

  const syncPlan = planReadinessSync({ isDraft: pr.draft === true, currentLabels, prNumber: pr.number, claimOwner: effectiveClaimOwner });

  if (syncPlan?.blocked) {
    console.log(
      `issue-lifecycle-sync: issue #${issueNumber} is claimed by PR #${syncPlan.owner}, not PR #${pr.number}; ` +
        "not syncing its stage from this PR.",
    );
    await postWarningOnce({
      readClient,
      writeClient,
      owner,
      repo,
      pr,
      reason: syncPlan.reason,
      comment:
        `issue-lifecycle-sync: issue #${issueNumber} is already claimed by PR #${syncPlan.owner}, so this PR's ` +
        "draft/ready state is not being used to change its stage. If PR " +
        `#${syncPlan.owner} is stale or abandoned, resolve that manually before this PR can drive #${issueNumber}'s lifecycle.\n\n` +
        `<!-- issue-lifecycle:linkage-warning pr=${pr.number} reason=${syncPlan.reason} -->`,
    });
    return;
  }

  if (syncPlan) {
    console.log(
      `issue-lifecycle-sync: syncing issue #${issueNumber} to ${syncPlan.addLabel} (PR #${pr.number} draft=${pr.draft}).`,
    );
    await applyLabelPlan(writeClient, owner, repo, issueNumber, syncPlan);
  } else {
    console.log(`issue-lifecycle-sync: issue #${issueNumber} already reflects PR #${pr.number}'s draft/ready state.`);
  }
}

async function handlePullRequestMergeCleanup({ readClient, writeClient, owner, repo, pr }) {
  const issueNumber = await resolveLinkedIssue({ readClient, writeClient, owner, repo, pr });
  if (issueNumber === null) return;

  const issue = await readClient.getIssue(owner, repo, issueNumber);
  const comments = await readClient.listIssueComments(owner, repo, issueNumber);
  const claimOwner = currentClaimOwner(comments);

  const plan = planMergeCleanup({ issueState: issue.state, currentLabels: labelNames(issue), prNumber: pr.number, claimOwner });

  if (plan?.blocked) {
    console.log(
      `issue-lifecycle-sync: issue #${issueNumber} is claimed by PR #${plan.owner}, not merged PR #${pr.number}; ` +
        "not running merge cleanup from this PR.",
    );
    await postWarningOnce({
      readClient,
      writeClient,
      owner,
      repo,
      pr,
      reason: plan.reason,
      comment:
        `issue-lifecycle-sync: issue #${issueNumber} is claimed by PR #${plan.owner}, not this PR, so merging this ` +
        `PR did not close #${issueNumber} or touch its stage labels. If #${issueNumber} is actually done, close it ` +
        `directly or merge PR #${plan.owner}.\n\n` +
        `<!-- issue-lifecycle:linkage-warning pr=${pr.number} reason=${plan.reason} -->`,
    });
    return;
  }

  if (!plan) {
    console.log(`issue-lifecycle-sync: issue #${issueNumber} already clean after PR #${pr.number} merge; no action.`);
    return;
  }

  console.log(
    `issue-lifecycle-sync: merge cleanup for issue #${issueNumber} (PR #${pr.number} merged): ` +
      `closeIssue=${plan.closeIssue}, removeLabels=[${plan.removeLabels.join(", ")}].`,
  );
  for (const label of plan.removeLabels) {
    await writeClient.removeLabel(owner, repo, issueNumber, label);
  }
  if (plan.closeIssue) {
    await writeClient.closeIssue(owner, repo, issueNumber);
  }
}

async function handleIssueClosed({ writeClient, owner, repo, issue }) {
  // No claimOwner/prNumber here deliberately: a direct issue close (a human closing
  // it, or some future default-branch auto-close) is authoritative regardless of
  // which PR, if any, is recorded as the claim owner -- see planMergeCleanup's doc
  // comment and ADR 0003.
  const plan = planMergeCleanup({ issueState: "closed", currentLabels: labelNames(issue) });
  if (!plan) {
    console.log(`issue-lifecycle-sync: issue #${issue.number} closed with no stage:* labels; no action.`);
    return;
  }

  console.log(`issue-lifecycle-sync: issue #${issue.number} closed; removing [${plan.removeLabels.join(", ")}].`);
  for (const label of plan.removeLabels) {
    await writeClient.removeLabel(owner, repo, issue.number, label);
  }
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;

  if (!token) throw new Error("Missing required environment variable: GITHUB_TOKEN");
  if (!eventPath) throw new Error("Missing required environment variable: GITHUB_EVENT_PATH");
  if (!repository) throw new Error("Missing required environment variable: GITHUB_REPOSITORY");

  const [owner, repo] = repository.split("/");
  const payload = JSON.parse(readFileSync(eventPath, "utf8"));

  const readClient = createGithubClient(token);
  const writeClient = createGithubWriteClient(token);

  // The real workflow uses pull_request_target (see docs/decisions/0003 for why);
  // the integration test still uses pull_request, since it must exercise a PR's own
  // proposed code changes. Both deliver the same payload shape, so both are handled
  // identically here.
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const pr = payload.pull_request;
    const action = payload.action;

    if (action === "closed" && pr.merged === true) {
      await handlePullRequestMergeCleanup({ readClient, writeClient, owner, repo, pr });
      return;
    }

    if (action === "closed") {
      console.log(`issue-lifecycle-sync: PR #${pr.number} closed without merging; no lifecycle action.`);
      return;
    }

    if (["opened", "reopened", "ready_for_review", "converted_to_draft"].includes(action)) {
      await handlePullRequestSync({ readClient, writeClient, owner, repo, pr });
      return;
    }

    console.log(`issue-lifecycle-sync: no handling defined for pull_request action "${action}"; skipping.`);
    return;
  }

  if (eventName === "issues") {
    if (payload.action === "closed") {
      await handleIssueClosed({ writeClient, owner, repo, issue: payload.issue });
      return;
    }
    console.log(`issue-lifecycle-sync: no handling defined for issues action "${payload.action}"; skipping.`);
    return;
  }

  console.log(`issue-lifecycle-sync: no handling defined for event "${eventName}"; skipping.`);
}

main().catch((error) => {
  console.error("issue-lifecycle-sync failed with an unexpected error:");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

