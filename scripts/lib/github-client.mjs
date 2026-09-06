// Minimal, dependency-free, READ-ONLY GitHub REST API client used by the preflight
// verifier.
//
// Deliberately built on the platform `fetch` rather than @octokit/rest or similar:
// this repo's existing scripts (see scripts/github-app-token.mjs) avoid npm runtime
// dependencies for anything that runs inside a GitHub Actions job, so the action stays
// auditable from source with no supply-chain surface beyond Node itself.
import { API_ROOT, pathSegment, get, getAllPages, getAllPagesEnveloped } from "./github-http.mjs";

/**
 * Creates a GitHub API client scoped to a single token.
 *
 * This client is read-only by construction (only GET endpoints are exposed) because
 * the preflight verifier must never need write access, and should be usable with the
 * job's default GITHUB_TOKEN rather than the App token or Anthropic key. Write
 * operations (labels, comments, closing issues) live in the separate
 * github-write-client.mjs -- see github-http.mjs's header comment for why they are
 * not added here.
 */
export function createGithubClient(token) {
  return {
    async getRepository(owner, repo) {
      return get(`${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}`, token);
    },

    async getRepositoryContent(owner, repo, path, ref) {
      return get(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/contents/${path
          .split("/")
          .map(pathSegment)
          .join("/")}?ref=${pathSegment(ref)}`,
        token,
      );
    },

    async listRepositoryLabels(owner, repo) {
      return getAllPages(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/labels?per_page=100`,
        token,
      );
    },

    async listRepositoryIssues(owner, repo, state = "all") {
      return getAllPages(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues?state=${pathSegment(state)}&per_page=100`,
        token,
      );
    },

    async getIssue(owner, repo, issueNumber) {
      return get(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}`,
        token,
      );
    },

    async listIssueTimeline(owner, repo, issueNumber) {
      return getAllPages(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}/timeline?per_page=100`,
        token,
      );
    },

    async listIssueComments(owner, repo, issueNumber) {
      return getAllPages(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}/comments?per_page=100`,
        token,
      );
    },

    async getCollaboratorPermission(owner, repo, username) {
      return get(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/collaborators/${pathSegment(username)}/permission`,
        token,
      );
    },

    /**
     * Lists pull requests targeting a given base branch, most recently created
     * first. Used by the liveness monitor (issue #117) to find recent PRs against
     * `develop` -- `state: "all"` because a since-merged or since-closed PR that
     * opened inside the lookback window is still evidence the workflow should have
     * reacted to "opened", regardless of its current state.
     */
    async listPullRequestsForBase(owner, repo, base) {
      return getAllPages(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/pulls?base=${pathSegment(base)}&state=all&sort=created&direction=desc&per_page=100`,
        token,
      );
    },

    /**
     * Lists recent runs for a single workflow. `workflowFile` is the workflow's
     * filename (e.g. "issue-lifecycle-sync.yml") -- GitHub's API accepts the
     * filename as an alternative to the numeric workflow id, which avoids hardcoding
     * an id that would differ per fork/instance.
     */
    async listWorkflowRuns(owner, repo, workflowFile) {
      // Enveloped response: { total_count, workflow_runs: [...] }, not a flat array
      // -- see getAllPagesEnveloped's doc comment for the real bug this guards against.
      return getAllPagesEnveloped(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/actions/workflows/${pathSegment(workflowFile)}/runs?per_page=100`,
        token,
        (body) => body?.workflow_runs ?? [],
      );
    },

    /** Lists open issues carrying a given label, for diagnostic-issue deduplication (issue #117). */
    async listOpenIssuesByLabel(owner, repo, label) {
      return getAllPages(
        `${API_ROOT}/repos/${pathSegment(owner)}/${pathSegment(repo)}/issues?state=open&labels=${pathSegment(label)}&per_page=100`,
        token,
      );
    },
  };
}
