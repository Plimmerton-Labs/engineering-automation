// Minimal, dependency-free, WRITE-capable GitHub REST API client.
//
// Split from the read-only github-client.mjs (see github-http.mjs's header comment
// for the reasoning). This client is used by automation that genuinely needs to
// mutate issue state -- currently the lifecycle-sync automation (issue #26): posting
// claim comments, moving stage:* labels, and closing issues on merge cleanup.
//
// This client must never be used to gate a trust boundary -- see preflight-verify-core.mjs
// for that. It performs the label/comment bookkeeping that WORKFLOW.md describes as
// display, not authority.
import { API_ROOT, pathSegment, request } from "./github-http.mjs";

export function createGithubWriteClient(token) {
  return {
    async createRepositoryLabel(owner, repo, label) {
      return request(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/labels`,
        token,
        { method: "POST", body: label },
      );
    },

    async updateRepositoryLabel(owner, repo, currentName, label) {
      return request(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/labels/${pathSegment(currentName)}`,
        token,
        { method: "PATCH", body: { new_name: label.name, color: label.color, description: label.description } },
      );
    },

    /** Adds one or more labels to an issue (or PR, which shares the issues endpoint). */
    async addLabels(owner, repo, issueNumber, labels) {
      return request(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}/labels`,
        token,
        { method: "POST", body: { labels } },
      );
    },

    /**
     * Removes a single label from an issue. Tolerates 404 (label already absent) as
     * a successful no-op -- idempotent removal is the expected outcome, not an error.
     */
    async removeLabel(owner, repo, issueNumber, label) {
      return request(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}/labels/${pathSegment(label)}`,
        token,
        { method: "DELETE", tolerateMissing: true },
      );
    },

    /** Posts a comment on an issue or PR (both share the issues comments endpoint). */
    async createIssueComment(owner, repo, issueNumber, body) {
      return request(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}/comments`,
        token,
        { method: "POST", body: { body } },
      );
    },

    /** Closes an issue. Idempotent in effect: closing an already-closed issue is a no-op per the GitHub API. */
    async closeIssue(owner, repo, issueNumber) {
      return request(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}`,
        token,
        { method: "PATCH", body: { state: "closed" } },
      );
    },

    /** Updates the body and/or state of an existing issue (used for durable drift reports). */
    async updateIssue(owner, repo, issueNumber, changes) {
      return request(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}`,
        token,
        { method: "PATCH", body: changes },
      );
    },

    /** Creates a new issue. Used by the liveness monitor (issue #117) to raise a diagnostic issue. */
    async createIssue(owner, repo, { title, body, labels }) {
      return request(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues`,
        token,
        { method: "POST", body: { title, body, labels } },
      );
    },
  };
}
