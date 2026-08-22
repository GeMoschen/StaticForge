---
id: M6.5.1
status: done
depends: [M6.1.2, M6.2.2, M6.3.1, M6.4.2]
epic: m6-revision-ux
feature: collaboration-e2e
area: qa
---

# M6.5.1 — Collaboration journeys 5–8

## Context

Automate the four collaboration/resolution journeys of §25.6.

## Goals

- Journey 5: rename asset UID → warning lists affected templates → fix → build succeeds.
- Journey 6: two browsers edit same page → second save shows conflict drawer → per-field
  merge → save succeeds.
- Journey 7: time-travel to N-5, preview, restore one asset, verify new revision + intact
      history.
- Journey 8: delete media used by 3 pages → usage warning → force delete → build warns
      (not crash).

## Acceptance criteria

- [x] All four journeys pass on Chromium/Firefox/WebKit.

## Out of scope

- Journeys 1–4 (M3/M5) and 9–12 (M7).

## Notes / hazards

- Journey 6 needs two concurrent browser contexts.
