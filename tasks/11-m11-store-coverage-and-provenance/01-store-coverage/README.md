# Feature: Store coverage

**Spec:** Extends §26.5's selective export (`M10.1`) so every asset store the
model already has — Pages, Media, Navigation, and the (unfoldered) template
stores — is reachable through `ExportSelection`, plus a one-click "select
this entire store" convenience.

## Goal

`ProjectExportImportServiceImpl.resolveIncludedAssetIds` (`M10.1.1`) already
walks the full project snapshot with no asset-type or `FolderScope`
filtering, so a `NAVIGATION` folder, a lone `PAGE_REFERENCE`, or a lone
`PAGE_TEMPLATE`/`SECTION_TEMPLATE` UUID should already flow through the exact
same folder-subtree/ancestor-walk logic Pages/Media use today. This feature's
job is to prove that with tests, close whatever real gap they find, and add
the one genuinely missing primitive: a way to say "the whole Pages store" (or
Media, or Navigation) without enumerating every top-level folder by hand.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-navigation-export-selection.md](001-navigation-export-selection.md) | — |
| 2 | [002-template-export-selection.md](002-template-export-selection.md) | — |
| 3 | [003-store-root-selection.md](003-store-root-selection.md) | 1, 2 |

## Feature exit criteria

- [ ] A `NAVIGATION` folder or a single `PAGE_REFERENCE` exports/imports
      correctly (target, label, resolution intact).
- [ ] A single `PAGE_TEMPLATE`/`SECTION_TEMPLATE` exports/imports correctly,
      including alongside a page that references it (reference remapped).
- [ ] `ExportSelection` can express "every current top-level folder in this
      store" for Pages, Media, or Navigation without the caller enumerating
      them.

## Dependencies

`M10.1` (`ExportSelection`, `exportSelection`, `resolveIncludedAssetIds`).
`M1`/`M8` for `FolderScope`/`FolderService.tree`.
