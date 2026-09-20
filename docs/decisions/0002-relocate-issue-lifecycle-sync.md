# ADR-0002: Host reusable Issue Lifecycle Sync here, not in engineering-playbook

Status: Accepted

Related: [engineering-playbook#152](https://github.com/Plimmerton-Labs/engineering-playbook/issues/152), engineering-playbook's [ADR-0003](https://github.com/Plimmerton-Labs/engineering-playbook/blob/main/docs/decisions/0003-issue-lifecycle-sync-design.md) (original design rationale for the lifecycle-sync behaviour itself — not repeated here).

## Context

`Issue Lifecycle Sync` was originally implemented and distributed from `engineering-playbook`: a `workflow_call` reusable workflow plus a composite action, invoked by a small caller workflow copied into each consuming repository (`repository-template`, `engineering-playbook-sandbox`, and product repositories such as `homebridge-ups-monitor`).

That worked for private consumers, but GitHub's reusable-workflow access model does not permit a **public** caller to invoke a reusable workflow hosted in a **private** repository — only the reverse (a private caller may invoke either a private or public host). `engineering-playbook` is private. `homebridge-ups-monitor` is public, by necessity: it is a publicly distributed Homebridge/npm plugin with public source, releases, and users. Every `Issue Lifecycle Sync` run on `homebridge-ups-monitor` failed before a job was even created, for exactly this reason — confirmed against live Actions run history and GitHub's documented access matrix, not assumed.

Making `homebridge-ups-monitor` private was rejected: it would change the product's distribution and transparency model to accommodate an internal implementation constraint, not a genuine product reason.

## Decision

Relocate the reusable workflow, its composite action, and the implementation script it wraps (`scripts/issue-lifecycle-sync-run.mjs` and `scripts/lib/*`) from `engineering-playbook` to this repository, `engineering-automation`, which is public. `engineering-playbook` keeps its role as the private governance/control plane (policy, drift detection, category sync, ADRs); `engineering-automation` is the public distribution boundary for reusable Actions workflows and composite actions that public repositories need to consume.

This is strictly more permissive than the prior arrangement: a public caller can now reach this public host, and a private caller (such as `engineering-playbook-sandbox`, if it stays private) can still reach a public host just as it could reach a private one.

## Consequences

- Every consuming repository's caller workflow must be repointed from `Plimmerton-Labs/engineering-playbook/.github/workflows/reusable-issue-lifecycle-sync.yml@v1.0.0` to `Plimmerton-Labs/engineering-automation/.github/workflows/reusable-issue-lifecycle-sync.yml@<tag>` once a release exists here. As of this ADR that repoint has not happened yet — see engineering-playbook#152 for tracking.
- The design rationale for *what* the lifecycle sync does (claim comments, draft-PR handling, merge cleanup, stage-label invariants) stays in engineering-playbook's ADR-0003 rather than being duplicated here — this ADR only records *why the code lives in this repository instead*.
- Future reusable workflows or composite actions that a public repository needs to consume should default to living here for the same reason, rather than each needing its own visibility incident to discover the constraint.
