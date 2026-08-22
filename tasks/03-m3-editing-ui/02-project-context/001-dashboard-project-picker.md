---
id: M3.2.1
status: done
depends: [M3.1.1]
epic: m3-editing-ui
feature: project-context
area: frontend
---

# M3.2.1 — Dashboard & project picker

## Context

Build the project picker (§24.5 #2) and the nav rail for switching projects.

## Goals

- Implement the dashboard: cards with name, last revision, last activity, your role.
- Search-first mode when > 12 projects.
- Implement the nav rail (§24.4): 64px icons / 220px expanded, per-user persisted,
  project switcher at top.
- Lazy-load feature routes (`g p/m/t/r` land here in later features).

## Acceptance criteria

- [ ] Project cards render and switch context on selection.
- [ ] Nav rail persists its expanded/collapsed state per user.

## Out of scope

- Recent-activity feed (later / dashboard polish).

## Notes / hazards

- Keep entry animations ≤ 200 ms (§24.3 motion discipline).
