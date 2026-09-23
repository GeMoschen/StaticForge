---
id: M25.5.3
status: todo
depends: [M25.3.1]
epic: m25-record-sets
feature: ui
area: frontend
---

# M25.5.3 — Reference editor picks record sets; search, routing, export picker

## Context

`shared/components/asset-picker.util.ts` (`PickerType`, `PICKER_TYPE_OPTIONS`, `dataset` restriction →
records only), `sf-asset-picker-dialog.component`, `features/forms/editors/reference-editor.component`
(per-type display), `shared/asset-route.util.ts` (asset → route), `core/project/project-context.store.ts`,
`features/search/search.util.ts` (type labels/icons/routes), `features/settings/project-settings-export`
/ `-import` components.

## Goals

- `PickerType` gains `RECORD_SET` ("Record sets"). Options follow the editor's `assetTypes`; with
  `dataset "uid"` the picker offers `RECORD` and/or `RECORD_SET` (whichever `assetTypes` allows, both if
  unspecified) filtered to that dataset. The set list shows dataset name and record count.
- `reference-editor.component`: a set value shows name, dataset, record count and an "open" link; a
  dangling/deleted set shows the existing broken-reference state.
- `asset-route.util`: `RECORD_SET` → `content/sets/:uuid`; search palette/page: type label, icon, route.
- Export picker (Content scope) and import conflict icons — coordinate with `M25.4.1` (whoever lands
  second wires the remaining piece; don't duplicate).

## Acceptance criteria

- [ ] Vitest specs: `asset-picker.util` type options for all `assetTypes`/`dataset` combinations; reference
      editor rendering of set values; route and search mappings.
- [ ] Manual check: a page's reference editor restricted to dataset `team` lists only `team` sets; saving a
      value renders the set in preview.
- [ ] `npm run build` green.

## Out of scope

- Server-side validation of the restriction (`M25.2.2`).
