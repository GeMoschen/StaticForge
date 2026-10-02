---
id: M35.15
status: done
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

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

## Acceptance criteria

- [x] Vitest: record/dedupe/cap, favorite toggling, stale-entry removal, and persistence through preferences.
- [x] `npx vitest run` and `npx ng build` green.

## Notes (M35.10)

- Favorite projects and recent projects (cap 5) are already in the preferences and the project switcher (M35.10). This
  task adds the per-project asset recents and favorites, following the same pattern.

## Review (2026-10-02)

Design signed off in the sample first (gate round 5, decisions 57–60). Built as signed off, except where noted.

- **Services** (`core/assets/`): `RecentsService` (visit, dedupe and cap through the preferences, `verify`), `FavoritesService`
  (`toggle`, `isFavorite`, `remove`), `AssetRef`, `openedAsset(url)` and `assetLocation`. Entries carry kind (the asset
  type, `FOLDER` included), UUID, title and folder path (a folder needs it to find its store). A favorite is not
  store-bound: one list per project serves every screen, the palette and later the trees.
- **Recording:** `useAssetTracking()` in the frame listens to every navigation and resolves the open asset (page, record,
  record set, or a store's `?asset=` / `?folder=`) through the asset API, so no screen has to report what it opens.
- **Stale entries:** `verify` resolves recents *and* favorites when the palette opens (4 at a time, at most every 30 s per
  project): 404 or deleted → dropped from both lists; renamed or moved → new name and place; offline or server errors → left
  alone. Opening a stale asset drops it too.
- **☆ toggle:** `sf-asset-favorite` (pressed-state ghost button, toast, and a palette action *Add to / Remove from
  favorites* for the open asset while it is on screen) in the headers of the page editor, record editor, global set,
  navigation item, template, media drawer, and the pages, media and navigation folder panels.
- **Palette:** Recent and Favorites come from the services, with an icon per kind and the location as muted text.
- **Checks:** 261 test files / 2,242 tests, `ng build` and `npm run lint` green; checked in Chrome (star in the page header,
  Recent and Favorites in the palette, a deleted page disappears from both after the next open).
- **Open (belongs to the screen tasks, which migrate the screens to the design system):**
  - the *Favorites* node at the top of each tree and the ☆ in tree and table row menus — `sf-tree` already supports a
    `pinned` node (M35.15), and the sample shows the design: flat favorites with an icon per kind, favorite folders as
    lazily loaded folder nodes, a Favorites list in the main pane (M35.18–M35.22);
  - screens that open an item without putting it in the URL (`?asset=` / `?folder=`) are not recorded as recents until
    they do — do that when they migrate;
  - the dashboard and project home blocks (M35.28).
