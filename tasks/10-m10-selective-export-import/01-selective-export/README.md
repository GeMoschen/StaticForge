# Feature: Selective export

**Spec:** Extends §26.5's whole-project ZIP export with a caller-supplied selection of
assets/folders and an opt-in slice of project settings.

## Goal

Let an export be scoped to a subset of the project — specific assets, whole folders
(recursively), and/or project-level settings (`OutputChannel`s, `GenerationTarget`s) —
instead of always shipping every asset. The archive format grows a `settings.json`
entry but stays backward compatible with the existing whole-project export/import
path, which keeps working unchanged (it's the "select everything, include all
settings" case).

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-export-selection-domain.md](001-export-selection-domain.md) | — |
| 2 | [002-settings-archive-entry.md](002-settings-archive-entry.md) | 1 |
| 3 | [003-export-selection-api.md](003-export-selection-api.md) | 1, 2 |

## Feature exit criteria

- [ ] `ProjectExportImportService` can export an arbitrary `ExportSelection` (asset
      UUIDs + folders-with-descendants + settings flags) instead of only "the whole
      project."
- [ ] The archive's `settings.json` carries redacted `OutputChannel`/`GenerationTarget`
      config when settings are selected; omitted entirely otherwise.
- [ ] A REST endpoint accepts a selection and streams back a ZIP, mirroring the
      existing `/export` endpoint's auth (`ProjectRoleExpr.ADMIN`) and response shape.

## Dependencies

`M1` (asset/folder/revision machinery the existing exporter already relies on), `M4`
(`GenerationTarget`), `M5` (`OutputChannel`/`ChannelService`). Extends
`server/sf-domain/.../exportimport/ProjectExportImportServiceImpl` and
`server/sf-api/.../ProjectExportController` in place rather than forking a parallel
implementation.
