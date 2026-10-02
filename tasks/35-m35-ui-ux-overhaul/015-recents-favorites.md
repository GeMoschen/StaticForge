---
id: M35.15
status: todo
depends: [M35.3, M35.10]
epic: m35-ui-ux-overhaul
feature: frame
area: frontend
---

# M35.15 — Recents and favorites

## Context

User decision 14. Stored in preferences (M35.3): `recents` and `favorites` per project, plus favorite projects.

## Goals

- `RecentsService` records every opened asset (page, record, record set, media, template, global set, navigation item,
  settings page) with its type, UUID, display name and time. Duplicates are deduped and the list is capped. Items that
  have since been deleted are dropped when they fail to resolve.
- A favorite toggle (☆) in every editor header and in tree and table row menus, plus *Favorite project* in the
  switcher and on the dashboard.
- Recents and favorites are shown in:
  - the project switcher
  - the palette's empty state and groups
  - project home and the dashboard (M35.28)
  - an optional "Favorites" node at the top of each tree (only when there are favorites)
- Display names refresh when an asset is renamed. The item is resolved on open and removed if it no longer exists.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

## Acceptance criteria

- [ ] Vitest: record/dedupe/cap, favorite toggling, stale-entry removal, and persistence through preferences.
- [ ] `npx vitest run` and `npx ng build` green.

## Notes (M35.10)

- Favorite projects and recent projects (cap 5) are already in the preferences and the project switcher (M35.10). This
  task adds the per-project asset recents and favorites, following the same pattern.
