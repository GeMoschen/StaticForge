# Feature: Cross-project import identity

**Spec:** Revises §26.5/§6.1's current import behavior (`Import/copy operations create
new UUIDs`) now that uniqueness is per-project (`M9.1`) — a fresh UUID is only
*required* when the source UUID would collide with the target project, not
unconditionally.

## Goal

Change `ProjectExportImportServiceImpl.importProject` so it preserves each asset's
original UUID by default, and only mints a replacement when that UUID already exists
in the *target* project. This is the behavior change that makes "export this element,
import it into project B, it's the same element with the same identity" real — and it
turns "duplicate UUID" from an impossible case into a real, detectable conflict that
`M10` builds its conflict report on top of.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-preserve-uuid-on-import.md](001-preserve-uuid-on-import.md) | M9.1.2, M9.2.1 |
| 2 | [002-existing-import-tests-update.md](002-existing-import-tests-update.md) | 1 |

## Feature exit criteria

- [ ] Importing an archive into a project that has never seen its UUIDs preserves
      every asset's original UUID.
- [ ] Importing the same archive back into its *source* project (or any project that
      already has one of its UUIDs) mints a fresh UUID only for the colliding
      asset(s), remapping references consistently — the existing `UuidRemapper`
      machinery still does the remapping work, it's just invoked conditionally now
      instead of unconditionally.
- [ ] Existing whole-project export/import tests are updated to reflect the new
      default and still pass.

## Dependencies

`M9.1` (schema + finder) and `M9.2` (callers already project-scoped, so the importer's
own existence check is trustworthy).
