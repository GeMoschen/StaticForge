---
id: M6.1.1
status: done
depends: [M3.2.2]
epic: m6-revision-ux
feature: revision-spine
area: frontend
---

# M6.1.1 — Revision spine component

## Context

Build the 44px vertical rail of §24.2 — the spine of the interface.

## Goals

- Fixed left rail (≥1100 px; 6px strip below), monospace current revision at top.
- Ticks for last ~40 revisions, densest at top; own = filled, others = hollow; hover
  reveals label (`1842 you · Edited "Headline" · 12:04`).
- Live: a revision by another user arriving pulses the rail once (no toast/modal).
- Click a tick triggers time-travel (delegated to next task).

## Acceptance criteria

- [x] Rail renders correctly at both breakpoints; ticks show hover labels.
- [x] Incoming revisions pulse the rail without interrupting.

## Out of scope

- Time-travel execution (next task).

## Notes / hazards

- Respect §24.3 motion (≤ 200 ms) and amber-for-unsaved-only discipline.
