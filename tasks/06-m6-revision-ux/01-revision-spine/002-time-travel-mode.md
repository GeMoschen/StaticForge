---
id: M6.1.2
status: done
depends: [M6.1.1]
epic: m6-revision-ux
feature: revision-spine
area: frontend
---

# M6.1.2 — Time-travel mode

## Context

Implement the read-only "time-travel" state of §24.2, the single history mechanism.

## Goals

- Enter time-travel on tick click: thin amber frame around content, all inputs read-only,
  header `Viewing revision 1840 · Back to now`.
- Load the asset state at that revision (via `?revision=` / versions API).
- "Back to now" exits cleanly; this is the single history/diff/restore entry.

## Acceptance criteria

- [x] Entering time-travel makes the workspace read-only with a clear visual state.
- [x] Exiting restores editability without data loss.

## Out of scope

- Diff/restore actions (history feature) launch from here.

## Notes / hazards

- Persist no unsaved state across time-travel entry (guard first).
