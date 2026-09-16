---
id: M17.1.3
status: done
depends: [M17.1.2]
epic: m17-global-store
feature: domain
area: backend
---

# M17.1.3 — Export/import, revision diff and usages coverage for `GLOBAL_SET`

## Context

`ProjectExportImportServiceImpl` (`server/sf-domain/src/main/java/com/acme/staticforge/exportimport/`):

- Per-asset files (`M14`): `assets/<uuid>.json`.
- It is largely type-agnostic, but it special-cases `MEDIA` (blobs, ~lines 231/738) and
  `FOLDER` (picks, ~285).
- Fixed store roots are remapped by uid: `findFixedFolderByUid(assets, FolderScope.NAVIGATION_ROOT_UID | TEMPLATES_ROOT_UID | PAGES_ROOT_UID | MEDIA_ROOT_UID)`,
  ~lines 416–429.
- `ExportSelection.fullStores: Set<FolderScope>` drives "select this entire store"
  (`M11.1.3`, ~line 199).

`DiffServiceImpl` is type-agnostic (`JsonDiffer.diff` over payloads).
`AssetServiceImpl.usages` → `GET /assets/{uuid}/usages` is generic.

## Goals

- Export/import:
  - `globals_root` joins the fixed-folder remap, so importing into a project that already
    has `globals_root` reuses it instead of creating a duplicate or conflicting on uid.
  - `FolderScope.GLOBALS` is accepted in `ExportSelection.fullStores`.
  - Implicit ancestor-chain provenance (`M11`) works for sets in nested Globals folders.
  - Content references inside a set's `content` (media, internal links) are covered by
    the existing referential-integrity expansion. A set whose logo media isn't selected
    behaves exactly like a page whose image isn't selected (conflict report / warning,
    same `ConflictType`).
- Diff: verify that a values change shows field-level `content.*` changes and a schema
  change shows the `contentDefinition` text diff plus the `content.*` migration in the
  same revision. Add a test; change code only if something is wrong.
- Usages: verify that `GET /assets/{uuid}/usages` on a set lists the templates and pages
  that reference it once `M17.3.1` lands. Add the assertion to `M17.3.1`'s integration
  test if this task lands first.
- Round-trip integration test in `ProjectExportImportIntegrationTest`: export a full Globals
  store with two sets (one in a subfolder, one referencing a media), import into a fresh
  project and into the same project, then assert schema, values, uid and folder are
  intact and no duplicate root exists.

## Acceptance criteria

- [ ] Full-store export with `fullStores=[GLOBALS]` includes every live set and folder in
      the store, and import recreates them.
- [ ] Re-importing into a project that already has `globals_root` doesn't create a second
      root (`findFixedFolderByUid` covers `GLOBALS_ROOT_UID`).
- [ ] Missing referenced media on a set is reported through the same conflict/warning path
      as for pages.
- [ ] Older archives (no Globals store) still import unchanged (`M14.2` shape-aware reader).
- [ ] A revision diff of a set's value change and schema change is correct (test added).
- [ ] `ProjectExportImportIntegrationTest` green, including the new round-trip.

## Out of scope

- The UI export picker entry for the Globals store (`M17.4.1`).
- Locale settings in archives (`M24.5.1`).

## Notes / hazards

- `manifest.protocolVersion`: adding an asset type is an additive change to archives, so
  older readers would see an unknown `type`. Check how the importer treats unknown types
  today. If it fails hard, a protocol bump with a clear "archive requires a newer
  StaticForge" error beats a half-import.
- The UI `project-settings-export.component.ts` has ~8 store-specific branches, so it needs
  a Globals entry in the same release. That's tracked in `M17.4.1`, but don't release this
  task without it, or users can import Globals they can't select for export.
