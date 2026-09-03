# Learnings

Project-specific learnings, kept local by default. See engineering-playbook's WORKFLOW.md, "Learning Feedback Loop".

## How to use this file

- Add an entry whenever something worth remembering happens: a mistake, a surprising result, a decision that didn't hold up, a pattern worth repeating.
- Most entries stay here, local to this project — that's the default, not an oversight.
- If a learning would benefit other projects — a workflow fix, a skill improvement, a guardrail gap, a label taxonomy change — raise it explicitly: apply `playbook-candidate` to the originating issue, or open an issue/PR directly against engineering-playbook. Don't rely on someone eventually noticing it here.
- The Playbook Steward (not built yet) will periodically read this file and `playbook-candidate` items across project repos to propose playbook updates. Until then, raising candidates explicitly is the only path back to the playbook.

## Entries

### 2026-09-02 — Project birth and ongoing inheritance need separate paths

The template can seed registration tooling and thin callers, but it cannot keep existing repositories current. New repositories explicitly register with the Engineering Playbook; the central detector then reports category-level drift and remediation uses the current playbook policy through normal review.

<!-- Add entries below, most recent first. A short heading plus a few sentences of what happened and what to do differently is enough -- this is a working log, not a formal document. -->
