# Feature: Import conflict detection

**Spec:** New capability, extending §26.5's import path with a read-only pre-flight
check, on top of `M9`'s per-project UUID uniqueness.

## Goal

As of `M9`, an asset's UUID is unique **within its project**, not server-wide, and
import preserves the source UUID by default (only remapping when it would collide).
That makes "duplicate UUID" a real, checkable fact — does this UUID already exist in
the *target* project? — instead of the pre-`M9` world where nothing ever conflicted
because every import minted a fresh UUID unconditionally. Selective, repeatable
exports (`M10.1`) make this reachable in practice: re-importing the same element into
its origin project, or an updated selection that leaves out a referenced template,
should show the user exactly what's wrong — **before** anything is written — with a
clean way to back out.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-conflict-report-domain.md](001-conflict-report-domain.md) | M10.1.1 |
| 2 | [002-analyze-import-service.md](002-analyze-import-service.md) | 1 |
| 3 | [003-analyze-import-api.md](003-analyze-import-api.md) | 2 |

## Feature exit criteria

- [ ] `ProjectExportImportService` can analyze an uploaded archive against a target
      project and return a `ConflictReport` without writing anything.
- [ ] The report distinguishes **blocking** conflicts (must be resolved or the import
      is refused) from **warnings** (informational, import proceeds if the user
      confirms).
- [ ] `importProject` (the commit path) re-checks blocking conflicts itself and refuses
      with 409 if any are present — a client cannot bypass the check by skipping the
      analyze call.

## Dependencies

`M9` (project-scoped UUIDs — this feature's central conflict type, duplicate UUID, is
only a real fact once uniqueness is per-project and import preserves source UUIDs by
default). `M10.1` (selective export — a narrow export is what makes "missing template"
and "settings key collision" conflicts actually reachable; a whole-project
export/import can still hit "duplicate UUID" on a same-project re-import, but the
other two categories need selection to exist first).
