---
id: M19.4.1
status: done
depends: [M19.2.1]
epic: m19-content-store
feature: ui
area: frontend
---

# M19.4.1 — Content store shell + dataset schema editor

## Context

Stores are feature folders under `ui/src/app/features/` (`pages`, `media`, `navigation`,
`templates`) with routes in `app.routes.ts` (`p/:projectKey/<store>`) and entries in
`dashboard/nav-rail.component.ts`. `M8.1.6` built the navigation store (component, service, tree
node, folder/reference detail). Templates are edited in `features/templates/templates.component.html`
with plain `<textarea>`s for CDL and OCTL and `validateCdl` diagnostics. Asset creation goes through
`shared/components/sf-create-asset-dialog.component.ts` (`CreateAssetKind` union); tree helpers:
`tree-sort.util.ts`, `tree-clipboard.service.ts`; the export picker lives in
`features/settings/project-settings-export.component.ts`.

## Goals

- **Content store:** new `features/content/` (component, service against the `M19.2.1` API, tree
  node, folder detail), route `p/:projectKey/content`, nav-rail entry "Content" (placed after Pages,
  aligned with whatever order `M17.4.1` chose for Globals).
  - Tree of Content folders; records shown under their folders with a dataset badge; a dataset
    filter chip row above the tree ("All", one chip per dataset).
  - Create folder / create record (dataset chooser when more than one dataset exists) via
    `sf-create-asset-dialog` (`CreateAssetKind` gains `RECORD`, `DATASET`).
  - Move/copy-paste with `tree-clipboard.service.ts` restricted to the Content scope; sorting via
    `tree-sort.util.ts`.
  - Empty state when no dataset exists: explains that a developer must define one, with a link to the
    Templates store for users with DEVELOPER role.
- **Dataset schema editor** inside the Templates store (`datasets` fixed folder shown as a third
  group next to Page/Section templates): CDL textarea with live `validateCdl` diagnostics, the new
  "bodies not allowed" diagnostic, `titleEditor` select (populated from compiled `text` editors),
  description, record count + "Open records" link; delete disabled with explanation while records
  exist.
- **Export picker:** Content store and `datasets` folder selectable, including "select whole store".
- Time travel: all create/edit/move/delete controls disabled while `TimeTravelStore.isTimeTravel`.

## Acceptance criteria

- [x] Routes, nav rail entry and store render with real API data; role-dependent affordances (VIEWER
      sees no create; EDITOR cannot edit schemas).
- [x] Creating a dataset with CDL errors shows diagnostics inline and does not save; valid CDL saves
      and appears under `datasets`.
- [x] Creating a record from the tree opens the record editor route (`M19.4.2` provides the editor —
      until then, a placeholder route is acceptable within this task).
- [x] Keyboard: tree navigation, create dialog and chips fully operable; axe checks clean on the new
      screens.
- [x] Component spec tests added; `npm run build` green (note the known `templateUrl` spec-runner
      issue in `M15` if `npm test` cannot run them).

## Out of scope

- Record grid and record editor (`M19.4.2`), Monaco/OCTL language support (`M20.4.1` area),
  bulk actions.

## Notes / hazards

- `CreateAssetKind` is referenced in several places (`project-context.store.ts`, asset picker,
  export component); add the new kinds everywhere at once, or the create dialog silently offers
  nothing.
- Keep the Content store generic over datasets — no per-dataset routes or components generated from
  schemas.

## Implementation notes (2026-09-16)

- Lazy `content` route (child `records/:recordUuid`) and nav rail entry after Pages; the `templates` route was made
  lazy too (initial bundle 864 → 812 kB, under the budget warning).
- `sf-content`: dataset chips (radio group with arrow keys, record counts), Content folder tree, grid, editor outlet.
  **Deviation:** the tree shows folders only; records are listed in the grid — a tree of thousands of records is
  neither usable nor pageable.
- The Templates store lists datasets under the fixed `Datasets` folder; `sf-dataset-schema-editor` validates live via
  `POST /cdl/validate?kind=DATASET`, picks the title editor, shows the record count and the delete guard. The create
  dialog supports DATASET/RECORD. Create affordances follow roles and time travel.
- Verified live: `ui/e2e/m19-journeys.spec.ts` journeys 1–2 (SF-CDL-0108 inline, save, record creation opens editor).
- **Caveats:** axe-core isn't installed in this workspace (see `e2e/a11y.spec.ts`), so accessibility was checked by
  structure (roles, labels, keyboard), not by an axe run. Component specs don't run under the current vitest setup,
  like every `templateUrl` component spec (M15); the pure-logic specs (`content.service.spec.ts`,
  `record-grid.util.spec.ts`, `asset-picker.util.spec.ts`) pass. `npm run build` green.
