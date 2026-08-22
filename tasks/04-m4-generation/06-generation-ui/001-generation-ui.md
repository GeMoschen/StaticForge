---
id: M4.6.1
status: done
depends: [M4.5.2]
epic: m4-generation
feature: generation-ui
area: frontend
---

# M4.6.1 — Generation dialog, live log & history

## Context

Implement the Generate screen (§24.5 #10).

## Goals

- Dialog: mode (full/incremental), channels, target, comment → start a run.
- Live log (SSE): per-stage progress, error/warning grouping by code, file-count summary.
- Errors link to the offending template line (§24.5).
- Run history list + promote/rollback to a previous build.

## Acceptance criteria

- [ ] Starting a run shows live SSE progress in the dialog.
- [ ] Diagnostics group by code with a file count; template errors deep-link.
- [ ] History lists runs and supports promote.

## Out of scope

- Redesign/polish (M7).

## Notes / hazards

- Handle SSE reconnection gracefully.
