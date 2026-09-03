# ADR-0001: Use Architecture Decision Records

Date: 2026-06-27
Status: Accepted
Deciders: Plimmerton Labs Engineering

---

## Context

Plimmerton Labs engineering principle 6 requires that significant architectural decisions are documented so future contributors — human and AI — can understand why a system was designed a particular way and make informed changes without repeating past debates.

Without a standard format and location for recording decisions, context is lost as teams and systems evolve. This is particularly important in an environment where AI agents contribute to the codebase, as agents lack the organisational memory that human contributors accumulate over time.

## Decision

We will use Architecture Decision Records (ADRs) to document significant decisions that affect system structure, behaviour, security, scalability, data, or operational characteristics.

ADRs are stored in `docs/decisions/` within each repository, numbered sequentially, and written in Markdown. The template at `docs/decisions/template.md` defines the standard format.

An ADR is required when a decision:

- introduces or changes a significant architectural boundary or pattern;
- affects security, privacy, or data handling;
- makes a trade-off with meaningful long-term consequences;
- is likely to be questioned or revisited by future contributors;
- supersedes or replaces a previous decision.

Not every PR needs an ADR. Small, obvious, or easily reversible changes do not require one.

## Alternatives considered

| Option | Reason not chosen |
|--------|-------------------|
| Inline comments only | Comments are lost during refactoring and are not discoverable without reading the code |
| Wiki or external docs | Decoupled from the codebase; harder to keep in sync with changes; not available to agents reading the repo |
| No formal process | Context accumulates only in team memory, which degrades as the team or codebase changes |

## Consequences

### Positive

- Future contributors can understand the rationale behind significant decisions without requiring tribal knowledge
- AI agents have discoverable context when proposing or reviewing changes
- Decisions are version-controlled alongside the code they describe
- Trade-offs and alternatives are explicit and reviewable

### Negative / Trade-offs

- Small overhead when a decision warrants an ADR
- Requires discipline to write ADRs at decision time rather than retrospectively

### Risks and mitigations

The main risk is ADR rot — records that become stale or are never written. Mitigated by keeping the process lightweight: the template is short, the bar for what needs an ADR is explicit, and the PR review process is the natural prompt to write one.

## Follow-up

- Reference this ADR when onboarding new contributors or agents to the repository.
- Update ADRs when decisions are superseded; record the superseding ADR number in the status field.
