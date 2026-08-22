---
id: M7.5.2
status: done
depends: [M3.2.2, M4.6.1, M5.4.1, M6.5.1]
epic: m7-hardening
feature: quality-gates
area: qa
---

# M7.5.2 — Full 12-journey E2E suite

## Context

Consolidate all twelve §25.6 journeys into a single green Playwright suite.

## Goals

- Ensure journeys 1–12 all run cleanly across Chromium/Firefox/WebKit.
- Journey 9: required-editor added → existing pages error at publish, not save.
- Journey 10: non-member gets 404 + can't call API. Journey 11: editor role can't open
  the template IDE (route hidden + 403). Journey 12: full keyboard publish (no mouse).

## Acceptance criteria

- [ ] All 12 journeys green in CI across the three browsers.

## Out of scope

- New journeys (future increments appended to the list).

## Notes / hazards

- Keep journeys resilient to timing; prefer role-based assertions over snapshots.
