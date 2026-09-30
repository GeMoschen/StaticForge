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

## Acceptance criteria

- [ ] Vitest: record/dedupe/cap, favorite toggling, stale-entry removal, and persistence through preferences.
- [ ] `npx vitest run` and `npx ng build` green.
