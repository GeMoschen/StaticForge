---
id: M11.3.1
status: todo
depends: [M11.1.1, M11.1.2]
epic: m11-store-coverage-and-provenance
feature: export-import-ui-v2
area: frontend
---

# M11.3.1 — Navigation + template pickers in the export panel

## Context

`project-settings-export.component.ts` (`M10.3.2`) currently reads
`ProjectContextStore.pageFolderTree`/`mediaFolderTree` only, with a doc
comment explicitly scoping Navigation and templates out "per the task doc's
'folders and assets' framing." `M11.1` makes both fully selectable on the
backend; this task closes the frontend gap.

## Goals

- Extend `ProjectContextStore` with a `navigationFolderTree` signal, fetched
  the same way `pageFolderTree`/`mediaFolderTree` already are (`GET
  /folders?scope=NAVIGATION&depth=10`, added to the same `forkJoin` in
  `loadFor`) — do not fetch it ad hoc inside the export component; keep the
  store as the single place project-wide tree data lives, consistent with
  how Pages/Media already work.
- Add a Navigation folder-tree section to `project-settings-export.component`,
  reusing the exact same tri-state checkbox tree UI already built for
  Pages/Media (`M10.3.2`) — same component/logic, different data source.
- Add two flat, searchable lists — "Page templates" and "Section templates" —
  populated via `ApiClient.listAssets(projectKey, { type: 'PAGE_TEMPLATE' })`
  / `{ type: 'SECTION_TEMPLATE' }` with no `folder` param (templates aren't
  foldered — confirmed by `M11.1.2`), mirroring how `sf-asset-picker-dialog`
  already lists its non-folder types. Each item is individually checkable.

## Acceptance criteria

- [ ] A Navigation folder or a single `PAGE_REFERENCE` can be selected with
      the same tree-view-with-checkboxes interaction Pages/Media already
      have — one shared tree component/logic across all three foldered
      stores, not a Navigation-specific variant.
- [ ] A template can be selected individually from its flat list (templates
      have no folder hierarchy, so a tree view doesn't apply to them — this
      is a structural fact about the data, not a deviation from the
      tree-view requirement that applies to the three foldered stores).
- [ ] The request built for `exportSelection` includes UUIDs from all four
      sources (Pages, Media, Navigation, templates) together, correctly
      merged into one `assetUuids` array.

## Out of scope

- `project-settings-import.component` — untouched by this task.
- The "select entire store" one-click control — `M11.3.2`.

## Notes / hazards

- Match `M10.3.2`'s existing lazy-expand-and-fetch pattern for the
  Navigation tree (don't assume the whole tree fits in memory, same
  reasoning that already applies to Pages/Media).
