---
id: M35.23
status: todo
depends: [M35.11, M35.12, M35.13, M35.14, M35.15]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.23 — Changes, schedules and release dialogs

## Context

`features/changes/*` (the reference-quality list), `features/schedules/*`, `features/release/*` (`release-bar`,
`release-dialog`, `release-plan`, schedule dialog). Screenshots 15–16, 70–72, 75–77. User decision 20: Changes keeps
one row per language.

## Goals

- **Changes:**
  - Moves onto `sf-data-table`, keeping every current capability: URL filters, chips, bulk Release/Discard/Schedule,
    row keyboard, pager, diff pane.
  - The filter bar is compacted into one row (search, type, status, language, changed by, folder, sort) with chips
    below only when active.
  - Rows show names, never record UUIDs; UIDs appear in developer mode.
  - The default language is listed first.
  - Fix the page height (M35.1 item 11): the table fills the frame.
  - The diff pane sits in an `sf-splitter`.
- **Schedules:**
  - `sf-data-table`; row actions in a ⋮ menu; Cancel with confirm.
  - Header action *New schedule* with a kind choice: release, unpublish, generation. Release schedules can be created
    here.
  - The history drawer (`sf-drawer`) has a full title.
- **Release dialog:**
  - One heading hierarchy. Language selection pre-ticks every changed language.
  - "All changed languages" is not styled as an error.
  - Warnings need the explicit confirmation (M33).
  - Blocking errors come with *Open* links.
- **Schedule dialog:** the title and kind are always explicit ("Schedule release" / "Schedule unpublish"), with a
  switch between them.
- **Release bar:** removed as a separate strip. Its actions move into the page header of every releasable editor
  (M35.18, M35.20, M35.22); this task provides the shared `sf-release-actions` component.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] No capability of Changes lost (checklist in notes). Vitest specs updated. `npx vitest run` and `npx ng build`
      green.

## Notes (M35.9)

- `sf-release-actions` is a group of its own in the editor header: spacing and a vertical divider separate its ⋮
  from the item's own ⋮ (M35.9 decision 34).
- `.sf-sr-only` is pinned to its containing block's corner (`top: 0; left: 0`), so hidden labels can't stretch scroll
  areas; the local `position: relative` workarounds in the changes list and admin tables are no longer required.
- Sample (decision 26) is the reference: the one-row-per-language list (compact filter bar, chips only when active,
  selection, bulk Release / Discard / Schedule) with the diff pane open in an `sf-splitter`; the release dialog
  (changed languages pre-ticked, warnings needing explicit confirmation, a blocking error with an Open link); the
  schedules list (⋮ row actions, New schedule: release / unpublish / generation); the schedule dialog (explicit title,
  kind switch).
