# Feature: Export/import

**Spec:** Extends §26.5 selective export (`M10.1`, `M11.1`) so the template
store's new folders (`M13.1`) are reachable exactly like Pages/Media/
Navigation folders, and round-trip correctly through import — including the
two fixed, protected folders, which must be re-identified rather than
duplicated.

## Goal

`ProjectExportImportServiceImpl.resolveIncludedAssetIds` already walks
folders generically by `FolderScope`-agnostic logic (a picked `FOLDER`
pulls in its live subtree; ancestor folders are walked up to root) — per
`M11.1.2`'s finding, this should mostly already work once templates have
real `folderId`/`folderPath` values (`M13.1`). This feature proves that,
closes any real gap, extends `fullStores` to cover `TEMPLATES`, and — the
one genuinely new problem — makes import recognize the two fixed folders by
their well-known uid instead of creating duplicates every time a project is
imported into or re-imported.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-template-folder-export-selection.md](001-template-folder-export-selection.md) | — |
| 2 | [002-fixed-folder-import-identity.md](002-fixed-folder-import-identity.md) | 1 |

## Feature exit criteria

- [ ] A template folder (with nested subfolders/templates) exports/imports
      correctly, same as a Pages/Media/Navigation folder does today.
- [ ] `ExportSelection.fullStores` accepts `TEMPLATES` and expands to both
      fixed folders' current top-level set, same as the other three scopes.
- [ ] Importing an archive that includes the fixed "Page Templates"/
      "Section Templates" folders (or their descendants) into a project
      that already has them (every project always does, per `M13.1.2`)
      merges into the existing fixed folders by identity — it never creates
      a second "Page Templates" folder, protected-duplicate or otherwise.
- [ ] `M11.1.2`'s existing template-selection tests (lone template export,
      template + referencing page) still pass unmodified — this feature
      must not regress folder-less-template behavior for any archive
      created before this milestone.

## Dependencies

`M13.1` (folders exist under templates at all — this feature has nothing to
build without it). `M10.1`/`M11.1` (`ExportSelection`, `fullStores`,
`resolveIncludedAssetIds`, `UuidRemapper`, `NON_FOLDER_ORDER` import
ordering).
