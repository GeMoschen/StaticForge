---
id: M10.2.1
status: todo
depends: [M10.1.1]
epic: m10-selective-export-import
feature: import-conflicts
area: backend
---

# M10.2.1 — Conflict report domain model

## Context

Need a shape for "here's what we found" that both a REST response and a UI conflict
list can consume directly, and that the commit-import path can reuse to re-validate
server-side. Built on top of `M9`'s per-project UUID uniqueness: an asset's UUID only
has to be unique within its own project, so "does this UUID already exist in the
target project" is now a plain repository lookup, not a heuristic.

## Goals

- `ConflictSeverity` enum: `BLOCKING`, `WARNING`.
- `ImportConflict` record: `severity`, `ConflictType` (see below), `String elementUuid`
  (nullable — settings-key conflicts have no asset UUID), `String elementLabel`
  (display name/UID/key, whatever's human-readable), `String detail` (free-text
  explanation for the UI).
- `ConflictType` enum with at least:
  - `DUPLICATE_UUID` (BLOCKING) — an `ExportedAsset.uuid` that already exists as an
    asset in the *target* project (per `M9`'s per-project unique constraint, this is a
    real collision the importer cannot resolve by minting a new UUID silently — doing
    so would sever the cross-project identity that `M9` exists to preserve). This is
    the common case for re-importing into the same project an element was exported
    from; importing the same UUID into a *different* project that doesn't already
    have it is not a conflict at all.
  - `MISSING_TEMPLATE_REFERENCE` (BLOCKING) — an `ExportedAsset.templateUuid` that
    resolves to neither another asset in the archive nor an existing asset (by UUID,
    now that `M9` makes cross-project UUID lookups meaningful, falling back to UID if
    the template was independently created in the target project under the same
    human-assigned UID) in the target project.
  - `MISSING_PARENT_FOLDER` (BLOCKING) — an `ExportedAsset.parentFolderUuid` not
    resolvable within the archive (should be prevented by `M10.1.1`'s ancestor-chain
    rule for exports produced by this system, but a hand-edited or third-party archive
    could still hit it — defense in depth).
  - `SETTINGS_KEY_COLLISION` (WARNING) — an `ExportedChannel`/`ExportedGenerationTarget`
    key that already exists in the target project (will be skipped on import per
    `M10.1.2`, not overwritten — surfacing it as a warning, not blocking, since skip is
    a safe default).
  - `PROTOCOL_VERSION_MISMATCH` (BLOCKING) — archive protocol newer/older than this
    service supports (subsumes today's blunt `SfException` throw in `readArchive` /
    `importProject` — same rejection, now expressed as a conflict entry instead of an
    exception, so the UI can render it in the same report list as everything else).
- `ConflictReport` record: `List<ImportConflict> conflicts`, `boolean hasBlocking()`
  derived helper.

## Acceptance criteria

- [ ] `ConflictReport.hasBlocking()` returns true iff any entry is `BLOCKING`.
- [ ] Every `ConflictType` maps to exactly one fixed `ConflictSeverity` (no
      per-instance severity override) — keeps client logic ("disable Proceed if any
      BLOCKING") simple and centralizes the safety decision in one place.
- [ ] `DUPLICATE_UUID` is defined in terms of "exists in the target project" only —
      nothing in this record depends on `payload.origin` provenance matching, since
      `M9` makes the UUID itself the authoritative identity check.

## Out of scope

- The analysis logic that produces these records (`M10.2.2`).
- Any resolution UI beyond "cancel" or "proceed" — no per-conflict override/merge
  controls in this epic.

## Notes / hazards

- Resist adding more `ConflictType`s speculatively — this list should map 1:1 to what
  the UI (`M10.3.3`) actually renders distinct copy for. Add a type only when a real
  failure mode needs its own message.
- Do not reintroduce a `payload.origin`-matching heuristic for duplicate detection —
  that was the pre-`M9` workaround for UUIDs never colliding; `M9` makes the real
  per-project existence check both simpler and strictly more correct.
