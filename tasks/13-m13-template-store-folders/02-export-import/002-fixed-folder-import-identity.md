---
id: M13.2.2
status: todo
depends: [M13.2.1]
epic: m13-template-store-folders
feature: export-import
area: backend
---

# M13.2.2 — Import re-identifies the fixed template folders

## Context

`ProjectExportImportServiceImpl`'s import path today gives every imported
asset a fresh UUID and remaps references (`UuidRemapper`) — appropriate for
ordinary folders, which have no fixed identity. The two `TEMPLATES` fixed
folders are different: every project already has exactly one "Page
Templates" and one "Section Templates" folder (`M13.1.2`, provisioned at
project-create time, each with a stable well-known `uid`). If an export
archive containing them is imported "fresh," import must recognize the
target project's *existing* fixed folders by that well-known uid and graft
the archive's template subtree onto them — not create a second, protected,
identically-named folder and leave the project with two "Page Templates"
roots.

This mirrors how `ProjectExportImportServiceImpl` already special-cases the
hidden global root on import (`assetUuids`... `ROOT_UID` check around line
~380/~703 in the current source — `assetService.ensureRootFolder(...)` /
the `ROOT_UID`-filtered skip in the asset-ordering walk) — the fixed
template folders need the same "resolve to the existing one, don't
recreate" treatment, one level down.

## Goals

- During import, when the archive contains a `FOLDER` asset whose `uid` is
  one of the two well-known template-root uids (`M13.1.2`), resolve it to
  the *target* project's existing folder with that uid (via
  `assetRepository.findByProjectIdAndAssetTypeAndUid`, same lookup
  `ensureRootFolder` already uses) instead of creating a new asset —
  remap the archive's uuid for that folder to the target's real uuid in
  `UuidRemapper`'s id map, same mechanism used elsewhere for uuid
  collisions.
- Everything nested *under* the fixed folder in the archive still imports
  normally (fresh uuids, normal `UuidRemapper` handling) — only the two
  fixed-folder assets themselves get this special resolve-not-create
  treatment.
- If the target project somehow lacks a fixed folder (shouldn't happen post
  `M13.1.2`/`M13.1.4`, but import must not assume it does — e.g. importing
  into a project mid-migration), fall back to `ensureTemplateFolders`
  (`M13.1.2`) to provision it, then proceed with the resolve-not-create
  path.
- `protected`/`templateKind` payload fields on the fixed folders are never
  overwritten by an imported version of them — the target project's
  existing payload for that folder wins; only its *contents* (child
  folders/templates) come from the archive.

## Acceptance criteria

- [ ] Exporting a project's whole `TEMPLATES` store and importing it back
      into the same project results in the same two fixed folders (no
      duplicates), with all templates re-imported as fresh assets nested
      correctly beneath them.
- [ ] Importing that same archive into a *different* project also resolves
      onto that project's own fixed folders, not new ones.
- [ ] The imported fixed folders remain `protected: true` after import even
      if the archive's copy of them (from before any future edit) somehow
      differs.
- [ ] Existing import behavior for the hidden global root and for ordinary
      Pages/Media/Navigation folders is unchanged — this task only adds a
      third identity-resolution case, it doesn't touch the other two.

## Out of scope

- Any change to how ordinary (non-fixed) folders are imported — they keep
  getting fresh uuids exactly as today.

## Notes / hazards

- Don't derive "is this a fixed template folder" from `displayName` — a
  user could rename the fixed folders' *contents'* siblings but not the
  fixed folders themselves (they're protected), so the well-known `uid` is
  the only reliable identity signal; confirm the export path
  (`ProjectExportImportServiceImpl`'s asset-serialization) actually
  preserves `uid` in the archive (it should — uid is preserved for every
  other asset type on export/import already) before relying on it here.
