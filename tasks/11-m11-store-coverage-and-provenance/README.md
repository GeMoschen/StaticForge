# M11 — Full-store coverage & selection provenance

**Spec:** Extends `M10`'s selective export/import (§26.5) to reach every
store the asset model already has (pages, media, navigation, templates), adds
a one-click way to pick an entire store, and introduces a new concept not
previously in the spec: distinguishing an **explicitly** picked element from
one **implicitly** pulled in only to keep referential integrity (an ancestor
folder chain), with an import-time option to skip re-creating an implicit
element that already exists in the target project.

## Goal

`M10` shipped selective export/import, but its own frontend picker only ever
exposed the Pages and Media folder trees — Navigation entries and templates
(page & section) were never wired into the UI, even though most of the
backend selection/expansion logic is asset-type-agnostic and likely already
handles them correctly underneath. Close that gap, add a one-click "select
this entire store" convenience so a whole-store export doesn't require
manually ticking every top-level folder, and add the ability for the importer
to recognize that some of what's in an archive was only included as
ancestor-chain padding — so a repeat import into a project that already has
that ancestor chain can skip re-creating it instead of either erroring or
silently minting a duplicate.

## Exit criteria (epic is done when)

- [ ] A user can select an entire `NAVIGATION` folder (or a single
      `PAGE_REFERENCE` entry) for export, and it imports correctly — target,
      label, and resolution all intact.
- [ ] A user can select a single `PAGE_TEMPLATE` or `SECTION_TEMPLATE` (with
      or without a folder concept, since templates aren't foldered) for
      export/import.
- [ ] A user can select "the whole Pages store" / "the whole Media store" /
      "the whole Navigation store" with one click, without first expanding
      every folder in that store's tree.
- [ ] Selecting and exporting a single non-folder element (a page, a media
      item, a page reference, a template) — already possible per `M10.1.1` —
      remains correct and is now reachable from every store's UI, not just
      Pages/Media.
- [ ] Every foldered store (Pages, Media, Navigation) is selected through the
      same checkbox tree-view component — no store gets a bespoke picker
      UI. Templates, which have no folder hierarchy, use a flat checkable
      list instead, per their own structure.
- [ ] Every element in an export archive is marked as either explicitly
      picked or implicitly included (an ancestor folder pulled in only to
      keep `parentFolderUuid` chains valid) — and the export tree itself
      shows this distinction live, before anything is exported, not just in
      the archive's own metadata: a folder pulled in only as ancestor
      padding reads visibly differently from one the user (or a
      folder-subtree pick) actually chose.
- [ ] Import has an opt-in ("skip already-existing implicit elements") that,
      when enabled, does not re-create an implicit element whose UUID already
      exists in the target project — it reuses the existing one instead,
      while every explicitly picked element keeps `M9.3.1`'s existing
      preserve-or-remap-on-collision behavior unchanged.
- [ ] The conflict report (`M10.2`) reflects the option's effect live: a
      `DUPLICATE_UUID` conflict on an implicit element stops being blocking
      once the option is enabled; the same conflict on an explicit element is
      never affected by it.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [store-coverage](01-store-coverage/README.md) | backend | `M10.1` (selective export) |
| 2 | [selection-provenance](02-selection-provenance/README.md) | backend | `M10.2` (conflict detection), 1 |
| 3 | [export-import-ui-v2](03-export-import-ui-v2/README.md) | frontend | 1, 2 |

## Dependencies

Builds directly on `M10`'s `ExportSelection`, `ExportedAsset`,
`ProjectExportImportServiceImpl.resolveIncludedAssetIds`, `ConflictReport`/
`ConflictType`, and the export/import settings-tab components
(`project-settings-export.component`, `project-settings-import.component`).
Also touches `FolderService`/`FolderScope` (M1/M8) for the whole-store
expansion and `ProjectContextStore` (frontend) for the navigation tree.

## Notes

- Most of `01-store-coverage`'s backend work is expected to be **verification
  and gap-closing**, not new plumbing — `resolveIncludedAssetIds` already
  operates generically over the full project snapshot regardless of asset
  type or `FolderScope`, and `NON_FOLDER_ORDER` already orders
  `PAGE_REFERENCE` correctly on import. Confirm this with tests before
  assuming new code is needed; only add code where a test actually fails.
- The project's hidden root folder (`PathService.ROOT_UID = "root"`, shared
  by all three stores, filtered out of every existing folder-tree endpoint)
  is deliberately **not** made independently selectable — see
  `01-store-coverage/003-store-root-selection.md` for why, and the derived
  "whole store" expansion used instead.
- `cms-specification.md` doesn't describe explicit/implicit provenance at
  all (it predates `M10`'s own selective-export addition) — as with `M8`/
  `M9`/`M10`, a spec follow-up note is a documentation task for later, not
  tracked here.
