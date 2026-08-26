---
id: M10.2.2
status: todo
depends: [M10.2.1]
epic: m10-selective-export-import
feature: import-conflicts
area: backend
---

# M10.2.2 — Analyze-import service method

## Context

`importProject` currently parses the archive (`readArchive`) and immediately starts
writing inside a `@Transactional` method. Analysis needs the same parse step with zero
writes, callable as its own operation, and the eventual commit path needs to reuse the
identical conflict logic so the two can never drift apart (analyze says "safe" while
commit silently behaves differently). By this point `M9` has changed
`ProjectExportImportServiceImpl` to preserve source UUIDs on import by default
(remapping only when necessary), so "does this archive's UUID already exist in the
target project" is a direct, meaningful question this method can just ask.

## Goals

- `ConflictReport analyzeImport(long targetProjectId, byte[] zipBytes)` on
  `ProjectExportImportService` — parses via the existing `readArchive` helper
  (refactored to be shared, not duplicated), then for each `ExportedAsset` and each
  `ExportedSettings` entry, checks it against `ConflictType`s from `M10.2.1`:
  - Protocol mismatch: checked first, short-circuits with just that one conflict (no
    point reporting template issues in an archive we can't even trust the shape of).
  - Duplicate UUID: `assetRepository.findByProjectIdAndUuid(targetProjectId,
    asset.uuid())` (or equivalent per-project lookup introduced by `M9`) — if present,
    `DUPLICATE_UUID`, `BLOCKING`. This single check replaces the pre-`M9`
    origin-provenance heuristic entirely; no `payload.origin` inspection needed here.
  - Missing template reference: for every asset with a non-null `templateUuid`,
    resolve against the in-archive UUID set first, then fall back to a
    `findByProjectIdAndUuid` lookup in the target project (now meaningful across
    projects thanks to `M9` — a template with the same UUID already present in the
    target, imported or created independently, satisfies the reference).
  - Missing parent folder: resolve `parentFolderUuid` against the in-archive set only
    (folders aren't looked up in the target — the exporter's ancestor-chain guarantee
    from `M10.1.1` means this should only ever fire on a malformed/foreign archive).
  - Settings key collision: for each `ExportedChannel`/`ExportedGenerationTarget`,
    check `OutputChannelRepository`/`GenerationTargetRepository` for an existing row
    with the same key in the target project.
- Extract the blocking-conflict check used by analyze into a method
  `assertNoBlockingConflicts(ConflictReport)` that `importProject` (`M10.2.3`'s sibling
  change, or done here — whichever lands first) calls at the start of its transaction,
  so commit can never proceed past a blocking conflict even if a caller skipped
  analyze.

## Acceptance criteria

- [ ] Analyzing a selective export (from `M10.1`) whose `templateUuid` points outside
      the selection, with no matching UUID in the target project, produces exactly one
      `MISSING_TEMPLATE_REFERENCE` conflict for that asset, `BLOCKING`.
- [ ] Analyzing an archive against the **same** project it was exported from produces a
      `DUPLICATE_UUID` conflict for every asset (each one's UUID already exists there).
- [ ] Analyzing the same archive against a **different** project that has never seen
      these UUIDs produces **no** `DUPLICATE_UUID` conflicts — this is the case `M9`
      exists to enable, and it must stay conflict-free.
- [ ] `analyzeImport` performs no writes — a repository-mutation assertion (mock or
      transaction-rollback test) confirms no `save`/`delete` calls happen.
- [ ] `importProject`, called directly with an archive that has a blocking conflict,
      refuses (see `M10.2.3` for the exact HTTP-level contract) rather than silently
      importing anyway.

## Out of scope

- The REST endpoint (`M10.2.3`).
- Any "resolve and retry" flow — analyze/commit is strictly report-then-accept-or-cancel
  in this epic, not an editable resolution wizard.

## Notes / hazards

- This method must be written *after* `M9` lands its `findByProjectIdAndUuid`-style
  repository method and its import-path UUID-preservation change — check that both
  exist before starting; if `M9` shipped a differently-named lookup, use that instead
  of adding a parallel one.
- Keep `analyzeImport` and `importProject` sharing one `readArchive` + one
  conflict-detection code path — two independent implementations that are supposed to
  agree are a guaranteed future bug.
