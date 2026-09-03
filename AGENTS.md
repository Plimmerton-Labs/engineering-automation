# AI Contributor Instructions

This file provides AI contributors with the context needed to work effectively in this repository.

Read the organisation-wide AI contributor instructions first:

> **[Plimmerton Labs Engineering Playbook — AGENTS.md](https://github.com/Plimmerton-Labs/engineering-playbook/blob/develop/AGENTS.md)**

That document covers: session start checklist, GitHub App identity, token helper, branch and PR conventions, committer identity, and shared rules for all agents.

The instructions below are specific to this repository.

---

## Session Start Checklist (repo-specific)

Before creating a branch or writing any code:

1. Follow the [org-level session start checklist](https://github.com/Plimmerton-Labs/engineering-playbook/blob/develop/AGENTS.md#session-start-checklist) — pull latest `develop`, check open PRs, check existing branches.
2. Read this file in full.
3. Read the project overview in [README.md](README.md).
4. Read the repository setup checklist in [docs/repository-setup.md](docs/repository-setup.md) before making governance, workflow, or branch-protection changes.
5. Read any ADRs in [`docs/decisions/`](docs/decisions/) relevant to the area you are working in.

---

## About This Repository

[Replace this section with a description of what the project does, its key responsibilities, and any important constraints or context an agent needs before making changes.]

## Key Conventions

[Replace with project-specific conventions: language, framework, test approach, code structure, naming patterns, environment setup.]

Every repository created from this template should define:

- the local setup command;
- the test/check command required before commit;
- the CI workflow names that must pass before merge;
- the branch profile and branch protection rules for every long-lived branch;
- the code owner or team responsible for review.

## Known Risks and Sensitive Areas

[Replace with areas that require extra care: security-sensitive code, data migrations, external integrations, user-facing behaviour, performance-critical paths.]

## Architecture Decisions

Significant decisions are recorded in [`docs/decisions/`](docs/decisions/). Read the relevant ADRs before proposing changes that affect system structure, boundaries, security, data, or operational behaviour.

## PR and Commit Standards

Follow the pull request template at [`.github/pull_request_template.md`](.github/pull_request_template.md).

Branch naming:

```
agent/claude/xyz
agent/codex/xyz
agent/chatgpt/xyz
agent/copilot/xyz
```

Use the GitHub App token helper from the engineering playbook to authenticate commits and PRs. For posting issue/PR comments or mutating labels, use engineering-playbook's `scripts/agent-github.mjs` (`comment`/`label add`/`label remove`, pass `--repo Plimmerton-Labs/<this-repo>`) instead of writing a one-off script or a raw API call -- it already solves markdown quoting and colon-in-label-name encoding, and it is a reference to the playbook's copy, not something to vendor into this template (see engineering-playbook#145 and repository-template#15 for why: the template is project-birth structure, not an inheritance channel -- a copied script would freeze at whatever state it was in on the day it was copied, and this specific tool has already been fixed twice in its first day).

Before the first feature PR is opened, choose the repository branch profile and configure active branch protection/rulesets for every long-lived branch. Template and organisation-metadata repositories usually use direct PRs to `main`; product repositories usually use `develop` and `main`. See [docs/repository-setup.md](docs/repository-setup.md).

---

## Worked Example

The sections below show what a filled-in version of this file looks like, using a fictional Node.js API project. Replace everything in your copy with your project's real details.

```markdown
## About This Repository

This is the `billing-api` service — a Node.js REST API that handles subscription creation,
renewal, and cancellation for the main product. It talks to Stripe for payment processing
and writes to a PostgreSQL database.

Key constraints:
- All Stripe webhook handlers are idempotent; duplicate delivery must not double-charge.
- The `subscriptions` table has ~2M rows; queries must use indexed columns only.
- PII (email, name, address) is stored here — no logging of raw request bodies.

## Key Conventions

Language: Node.js 20, TypeScript strict mode
Framework: Fastify v4
Tests: Jest — run `npm test` before every commit; all tests must pass
Lint: ESLint — run `npm run lint`; zero warnings policy
Database: PostgreSQL via `pg` — no ORM; raw parameterised queries only
CI checks that must pass: `test`, `lint` (defined in `.github/workflows/ci.yml`)

Branch profile: product repository — branch from `develop`, PR back to `develop`.
Merging to `develop` triggers a deploy to pre-production.
Promote `develop` → `main` by PR only; triggers deploy to production.

## Known Risks and Sensitive Areas

- `src/webhooks/stripe.js` — Stripe signature verification is critical; do not alter
  the verification logic without a security review.
- `src/db/migrations/` — migrations are irreversible once applied to production;
  always include a rollback path and discuss with the maintainer before running.
- `src/routes/admin.js` — admin endpoints bypass normal auth; changes here need
  explicit human review before merge.
- Any change to `subscriptions` table schema must account for the 2M-row size
  (online schema changes only; no table locks).
```