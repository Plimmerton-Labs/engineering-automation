# Repository Setup Checklist

Complete this checklist when creating a new repository from this template. It turns the playbook into concrete repository settings and files.

## Branches

Choose the branch profile that matches the repository:

1. **Template or organisation-metadata repositories** should usually use pull requests directly to `main`.
2. **Documentation or governance repositories** may use `develop` when a review queue is useful. If they do, configure an automated `develop` to `main` promotion PR so humans approve the promotion without having to create the PR manually.
3. **Product repositories** should usually create a `develop` branch from the initial `main` state, make feature work from `develop`, and promote `develop` to `main` by pull request only.

Do not create `develop` by habit. Add it when it provides useful integration, validation, or release-management control.

## Branch Protection / Rulesets

Protect every long-lived branch before regular work begins. For most template repositories this means `main`; for product repositories this usually means both `develop` and `main`.

Recommended defaults:

- block direct pushes;
- block branch deletion;
- block non-fast-forward updates;
- require pull requests;
- require CODEOWNERS review when CODEOWNERS is configured;
- require all project CI checks that prove the Definition of Done;
- do not add AI agents or automation to bypass lists unless explicit delegated authority is documented.

## Issue Labels

Before enabling issue-driven agent workflows in a new project repository, sync the shared workflow labels from `.github/labels.json`.

Labels are the visible state surface for the Engineering Playbook workflow. They are not the authority mechanism - state transitions are enforced by the future `state-guard` and role preflight - but the issue templates, human workflow, and agent workflows all expect these names to exist:

- `stage:triage`
- `stage:refining`
- `stage:ready`
- `stage:in-progress`
- `stage:in-review`
- `agent:go`
- `agent:blocked`
- `needs-design`
- `playbook-candidate`

Do not rely on GitHub repository-template behaviour to copy labels reliably. Run the sync script after creating the project repository and before enabling `state-guard`, `agent-triage`, `agent-refine`, or `agent-work`:

```sh
GH_TOKEN=... node scripts/sync-labels.mjs --repo Plimmerton-Labs/[project-name]
```

Preview the changes without mutating GitHub:

```sh
GH_TOKEN=... node scripts/sync-labels.mjs --repo Plimmerton-Labs/[project-name] --dry-run
```

Verify the manifest and diff logic offline:

```sh
node scripts/sync-labels.mjs --current-labels .github/labels.json --dry-run
node --test scripts/sync-labels.test.mjs
```

The sync is idempotent. It creates missing labels and updates labels whose colour or description has drifted, but it does not delete or rename unrelated project-specific labels.

The default bug and feature issue forms apply `stage:triage` automatically, so labels must be present before those forms are used for real project work.

## Project Configuration

Fill in `plimmerton-project.yml` at the repository root with this project's real values: project type, which workflow stages are active, which agent-workflow gates are enabled, spend caps, and any skill overrides. See the comments in the file itself for what each field means and when it is safe to change.

`gates` should stay `false` until the corresponding reusable workflow (`state-guard`, `agent-triage`, `agent-refine`, `agent-work`, `playbook-steward`) actually exists and this project is ready to enable it -- see WORKFLOW.md's phased rollout. The registration command reads `project_type` and `stages` to derive drift categories; no agent gate reads the file yet, so enabling a gate early has no execution effect.

## Engineering Playbook Enrollment and Drift

After replacing the placeholders in `plimmerton-project.yml`, enroll the new repository in the Engineering Playbook's central drift registry. Preview the derived project type and policy categories first:

```sh
npm ci
PLIMMERTON_AI_AGENT_TOKEN=... node scripts/register-with-playbook.mjs \
  --repo Plimmerton-Labs/[project-name] --dry-run
```

Then run the command without `--dry-run`. It validates organisation ownership and project configuration and opens a reviewed PR against `engineering-playbook`; it does not edit the playbook's protected branches directly. Re-running it is idempotent: it reports an existing matching enrollment or the already-open registration PR, and rejects conflicting duplicates.

Merging the registry PR enrolls the repository. Run the playbook detector manually for that repository immediately after merge rather than waiting for the weekly schedule. The detector maintains one report issue and never applies fixes unattended.

The included issue-lifecycle caller is pinned to the immutable `v1.0.0` playbook release. Do not merge or rely on it until that release exists, private cross-repository Actions access has been verified, and the invocation proof in the playbook release procedure has passed. In product repositories the caller is not active until it reaches the default branch (`main`), even if it has already merged to `develop`.

For ongoing label remediation, run the current playbook-owned command from a current `engineering-playbook` checkout rather than treating this template snapshot as the inheritance channel:

```sh
node scripts/sync-policy-category.mjs --category labels \
  --repo Plimmerton-Labs/[project-name] --dry-run
```

Review the output before re-running without `--dry-run`. To remove or archive a repository from monitoring, make a reviewed change to the central registry; do not silently disable the scheduled detector from the downstream repository.

## Docs Skeleton

This template provides the docs structure WORKFLOW.md's Phase 0 scope names:

- `docs/decisions/` - architecture decision records; see `docs/decisions/template.md` for the format.
- `docs/research/` - research notes, spikes, and exploratory material that inform decisions before they're formalised.
- `docs/design/` - design artefacts (user journeys, trust flows, safety handling, onboarding, service expectations) for product-significant work; required before an item meets the Definition of Ready, per WORKFLOW.md's "Design is first-class for product work."
- `docs/learnings.md` - the project's local learning log; see the file itself for how to use it and when to raise a `playbook-candidate` instead of keeping a learning local.

None of these have an automated reader or writer yet — they are structure, not automation.

## Required Files

Keep these files present and project-specific:

- `README.md` - product purpose, setup, usage, and contribution entry points;
- `AGENTS.md` - AI contributor context;
- `CONTRIBUTING.md` - human and AI contribution flow;
- `SECURITY.md` - private vulnerability reporting path;
- `plimmerton-project.yml` - local project configuration (project type, stages, gates, spend caps, skill overrides);
- `.github/CODEOWNERS` - review routing;
- `.github/labels.json` - issue-driven workflow label taxonomy;
- `.github/pull_request_template.md` - review evidence;
- `docs/decisions/template.md` - ADR format;
- `docs/research/README.md`, `docs/design/README.md`, `docs/learnings.md` - the docs skeleton described above.

## CI

Replace the generic repository hygiene workflow with project-specific checks once the technology stack is known. Required checks should include the command maintainers expect contributors to run locally before commit.

Examples:

- `pnpm check` for TypeScript monorepos;
- `npm test` for Node packages;
- `pytest` for Python projects;
- platform-specific build and test commands for mobile apps.

## Security and Secrets

- Enable GitHub secret scanning and Dependabot alerts where available.
- Store secrets outside the repository or in GitHub Actions secrets.
- Never document live credentials in issues, PRs, commits, or agent transcripts.

## First PR

The first project-specific PR should replace template placeholders with real project details before public contribution starts.
