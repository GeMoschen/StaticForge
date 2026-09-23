---
id: M25.5.3
status: done
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

- [x] Vitest specs: `asset-picker.util` type options for all `assetTypes`/`dataset` combinations; reference
      editor rendering of set values; route and search mappings.
- [x] Manual check: a page's reference editor restricted to dataset `team` lists only `team` sets; saving a
      value renders the set in preview. *(Done in `M25.6.2`'s journey against the dev stack: a `products` set is
      not offered, the pick autosaves and the preview renders the set; the picker row's dataset badge stretched
      across the row and was fixed there — see `M25.6.2`'s notes.)*
- [x] `npm run build` green.

## Out of scope

- Server-side validation of the restriction (`M25.2.2`).

## Implementation notes (2026-09-23)

- **Manual check not done in this lane** (it needs `gradlew bootRun`, and the backend agent holds Gradle; the
  server-side set restriction of `M25.2.2` was still in progress). Its checkbox stays open for the coordinator /
  the `M25.6.2` journey. The pieces it exercises are covered by component specs (picker restricted to `team`,
  reference editor rendering a set value).
- **Picker types** (`asset-picker.util`): `PickerType`/`PICKER_TYPE_OPTIONS` gain `RECORD_SET` ("Record sets").
  `pickerTypeOptions` with `dataset "uid"`: `RECORD` and/or `RECORD_SET` as far as `assetTypes` allows, both when it
  is empty/absent — and also both when it allows neither (the CDL rejects that with `SF-CDL-0104`, so the picker
  never shows an empty switch; before, this case offered records only). Without a dataset, the default switch now
  offers six types. New pure helpers `pickerRecordSets(sets, dataset, search)` and `recordCountLabel(n)`.
- **Picker dialog:** type `RECORD_SET` lists `GET /record-sets` once per dialog (no `?dataset=` call: the
  restriction is a dataset *uid* and the endpoint takes a uuid, so the list is filtered client-side by
  `set.dataset.uid`), searched by name/uid; each row shows the set name, a dataset badge and
  "N records · uid". `AssetPicked` gained optional `dataset` and `recordCount`, so the reference editor shows them
  right after a pick without another request.
- **Reference editor:** a `RECORD_SET` value is resolved through `GET /record-sets/{uuid}` and shows the set name
  as the "open" link (new tab, `content/sets/:uuid`), the dataset as its badge and the record count. A value stored
  without `assetType` that turns out to be a set is re-resolved through the set endpoint (the badge/link use the
  resolved type, the stored value is not rewritten).
  **Deviation:** the reference editor had no broken-reference state of its own — a failed lookup just showed the raw
  uuid (the server's `ContentValidator` finding appears under the editor). It now has one, for every asset type: a
  `404` shows "Not found" (no link), a deleted target "Deleted" (link kept — the set view offers Restore), with a
  `link_off` icon and a rust border; any other failure (network) stays neutral (uuid only, nothing claimed broken).
- **Routing and search:** `assetRoute` maps `RECORD_SET` → `content/sets/:uuid` (command palette and search page);
  `search.util` gains `RECORD_SET` in `TYPE_ORDER` (after `RECORD`), label "Record sets", icon `table_rows` (the
  Content tree's set icon). Search hits carry the plain `AssetType` name (`SearchIndexer` indexes
  `asset.getAssetType()`), so the type string is `RECORD_SET`.
- **Export picker (this task wires the UI half of `M25.4.1`'s "UI" goal):** the Content scope (`TreeScope`
  renamed `RECORD` → `RECORD_SET`) lists record sets (`GET /assets?type=RECORD_SET`) as leaves bucketed by their
  folder path; the set nodes the Content folder tree carries since M25 are stripped from the tree
  (`withoutRecordSets`), so a set is never a folder row and records are never listed. Hint: "A record set is exported
  with its records and its dataset."; empty state "No record sets". Selecting a set sends its uuid in `assetUuids`;
  that the server exports the set's records and dataset with it is `M25.4.1`'s backend part.
- **Import conflict icons:** `CONFLICT_ICONS` is a `Record<string, string>` over `ImportConflictView.type` (a plain
  string in `schema.d.ts`, not an enum), so the four new types are mapped ahead of the backend with no typing
  workaround: `RECORD_SET_DATASET_MISSING` `dataset_linked`, `RECORD_SET_MISSING` `table_rows`,
  `RECORD_SET_DATASET_MISMATCH` `rule`, `RECORD_OUTSIDE_RECORD_SET` `move_item`. `M25.4.1` needs no further UI work
  for the picker or the icons.
- Doc comments updated: `ProjectContextStore.contentFolderTree`, `EditorDefinition.dataset`.
- `schema.d.ts`/OpenAPI unchanged.
- **Tests:** `asset-picker.util.spec` (pickerTypeOptions for every `assetTypes`/`dataset` combination,
  `pickerRecordSets`, `recordCountLabel`), `asset-route.util.spec` (+1), `search.util.spec` (+1), new
  `reference-editor.component.spec` (6: set value with name/link/dataset/count, deleted, 404, network failure,
  typeless value resolving to a set, missing page), new `sf-asset-picker-dialog.component.spec` (3: `team`-restricted
  set list and emitted pick, type switch for a dataset without `assetTypes`, unrestricted list),
  `project-settings-export.component.spec` (+1: sets as leaves, records never listed, set uuid exported),
  `project-settings-import.component.spec` (+1: icons of the four conflicts). `npx vitest run` 441/441 (incl. the
  parallel `M25.5.2` specs), `npx ng build` green (no new warnings from these files).

### Follow-up (2026-09-23) — picker matches the server for `dataset "uid"` without `assetTypes`
- Fix: `pickerTypeOptions` offered records **and** record sets for a `reference` editor with `dataset "uid"` and no
  `assetTypes`, but the server (`ContentValidator.validateDataset`: records when `assetTypes` is empty or names
  `RECORD`, sets only when it names `RECORD_SET`) rejects a set there with a `dataset` ERROR. Now: no/empty
  `assetTypes` → records only (the M19 meaning); record sets only when `assetTypes` names them; neither allowed (a
  `SF-CDL-0104` CDL error) → records. This supersedes the "both when it is empty/absent" rule above.
  `asset-picker.util.spec` and `sf-asset-picker-dialog.component.spec` updated (no type switch and no set listing
  without `assetTypes`; the switch with `[RECORD, RECORD_SET]`).
