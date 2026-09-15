---
id: M19.1.1
status: todo
depends: []
epic: m19-content-store
feature: domain
area: backend
---

# M19.1.1 — `DATASET` / `RECORD` asset types, `CONTENT` scope, store provisioning

## Context

`AssetType` (`server/sf-domain/.../asset/AssetType.java`) is `PAGE, MEDIA, SECTION_TEMPLATE,
PAGE_TEMPLATE, FOLDER, PAGE_REFERENCE`, stored as `asset.asset_type varchar(30)` — adding values
needs no schema change. `FolderScope` (`asset/folder/FolderScope.java`) is `PAGES, MEDIA,
NAVIGATION, TEMPLATES` with `requiredFor(AssetType)` and the protected root uids; the hidden shared
root (`PathService.ROOT_UID = "root"`) parents every store. `M8` added `PAGE_REFERENCE` +
`NAVIGATION` the same way; `M13` added the fixed `page_templates`/`section_templates` folders under
`templates_root`; `M15` folded root provisioning in `ProjectServiceImpl.create` into one compound
revision.

## Goals

- Add `AssetType.DATASET` and `AssetType.RECORD`.
- Add `FolderScope.CONTENT` with protected root uid `content_root` (display name "All Content"),
  and a fixed, protected `datasets` folder under `templates_root` (`templateKind: "DATASET"`).
- `FolderScope.requiredFor`: `DATASET → TEMPLATES` (must sit in the `datasets` folder or a subfolder
  of it — mirror how section templates are constrained to `section_templates`), `RECORD → CONTENT`.
- Provisioning: add `ensureContentRootFolder` and extend `ensureTemplateFolders` with `datasets`,
  both joining the project-creation batch (`allocateOrJoin`), and both self-healing lazily for
  projects created before this milestone (same pattern as the existing template-folder self-heal in
  `TemplateServiceImpl`).
- Reserve the new root/fixed uids in `UidGenerator` so no user asset can take them.
- **Decide and document** the record → dataset link storage: `payload.datasetRef` (UUID string, source
  of truth) mirrored into `asset_version.template_asset_id` by the domain layer (recommended — see
  epic Notes), including a repository query `findCurrentRecordsOfDataset(projectId, datasetAssetId)`
  and its revision-pinned counterpart for snapshots. Record the decision in the task's Notes when done.
- Ensure every existing `switch`/`if` over `AssetType` is either extended or explicitly defaulted:
  `AssetServiceImpl` (`create` scope hint, `softDelete`, `move`, `changeUid`), `FolderServiceImpl`
  (`tree`, `updateStartNode`), `Snapshot`, `GenerationService`, `BuildPlanner`, `AssetCopyStage`,
  UI `CreateAssetKind` is **not** part of this task (`M19.4.1`).

## Acceptance criteria

- [ ] Creating a project still yields exactly one revision; its `summary.assets` now also lists
      `content_root` and `datasets` (update the `M15.6` assertion accordingly).
- [ ] An existing project without the new folders gets them on first dataset/record creation, inside
      that creation's revision.
- [ ] Creating a `RECORD` outside the Content store, or a `DATASET` outside `datasets`, fails with the
      same error shape `FolderScope` violations use today.
- [ ] Protected folders cannot be renamed, moved or deleted (existing protection applies).
- [ ] `template_asset_id` (or the chosen alternative) is populated for records and covered by a
      repository test for current and revision-pinned reads.
- [ ] `./gradlew :server:sf-domain:test` and ArchUnit module/`@RevisionAware` gates green.

## Out of scope

- Services with validation/migration (`M19.1.2`), REST (`M19.2.1`), UI (`M19.4.*`), export/import
  (`M19.1.3`), OCTL prefixes (`M19.3.2`).

## Notes / hazards

- `ProjectExportImportServiceImpl` remaps fixed folders explicitly (`ensureNavigationRootFolder`
  etc. around lines 416–429) — adding folders here without `M19.1.3` makes an import into a fresh
  project miss them; keep `M19.1.3` close behind.
- `template_asset_id` currently implies "page → template" in `AssetServiceImpl`/`FolderServiceImpl`/
  export code; grep every read of it and make sure none of them now mistakes a record for a page
  (e.g. "pages using template X" must filter `asset_type = PAGE`).
- `M17.1.1` adds `GLOBALS` the same way; if it landed first, align naming/ordering of the stores
  (nav rail order, export `fullStores`) with it.
