---
id: M10.1.1
status: todo
depends: []
epic: m10-selective-export-import
feature: selective-export
area: backend
---

# M10.1.1 — Export selection domain model

## Context

`ProjectExportImportService.exportProject(long projectId)` always snapshots
`assetVersionRepository.findCurrentSnapshot(projectId)` in full. To scope an export we
need a selection the caller builds in the UI and the service turns into the same asset
list that whole-project export already produces (folders included recursively, so
picking a folder implicitly picks its live descendants).

## Goals

- New `ExportSelection` record: `Set<UUID> assetUuids` (explicitly picked
  non-folder assets and/or folders — a picked folder means "this folder and everything
  currently under it"), `boolean includeChannels`, `boolean includeGenerationTargets`.
  An empty/`null` `assetUuids` with both flags `false` is rejected (nothing to export)
  rather than silently producing an empty archive.
- `ProjectExportImportService.exportProject(long projectId)` becomes a thin call to a
  new `exportSelection(long projectId, ExportSelection selection)` with a selection
  that means "everything" (all current asset UUIDs, both settings flags true) — same
  bytes as today, so existing callers/tests are unaffected.
- Selection expansion: for each folder UUID in `assetUuids`, walk
  `AssetVersionRepository.findCurrentSnapshot` results by `folderPath` prefix to pull in
  every live descendant (folders, pages, media, templates, page references)
  transitively, matching how the current exporter already walks the whole tree — no
  new recursive-fetch query needed, just a filter over the existing snapshot.
- Always include every ancestor folder of a selected asset up to the project root,
  even if not explicitly picked — otherwise `parentFolderUuid` chains break on import.

## Acceptance criteria

- [ ] `ExportSelection.everything()` (or equivalent factory) reproduces byte-identical
      output to the current `exportProject` for a project with no settings selected
      differently — covered by a test that diffs old vs. new output for the same
      fixture project.
- [ ] Selecting a single folder UUID exports that folder, its ancestors up to root,
      and all live descendants — verified with a nested-folder fixture.
- [ ] Selecting a single non-folder asset (e.g., a `PAGE`) exports just that asset plus
      its ancestor folder chain — its `templateUuid` target is **not** auto-included
      (that's `M10.2`'s conflict-detection job to flag on import, not this task's job to
      silently pull in).
- [ ] Rejecting an empty selection throws the same `SfException`/`ProblemFactory`
      pattern used elsewhere in this package (see `unprocessableEntity` usage in
      `ProjectExportImportServiceImpl`).

## Out of scope

- Settings serialization into the archive (`M10.1.2`).
- The REST endpoint (`M10.1.3`).
- Conflict detection on import (`M10.2`).

## Notes / hazards

- Don't auto-include template references — that would silently balloon a "just this
  one page" export into "this page plus every template it happens to use plus their
  transitive media," defeating the point of a selective export. Missing-template is a
  conflict to surface on import (`M10.2.1`), not a gap to paper over on export.
- Reuse `assetVersionRepository.findCurrentSnapshot(projectId)` as the single source of
  truth for "what's live right now" — don't add a second query path that could drift
  from what whole-project export already trusts.
