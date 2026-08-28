---
id: M15.2.2
status: done
depends: [M15.1.1]
epic: m15-compound-revisions
feature: orchestrated-writes
area: backend
---

# M15.2.2 — UID-rename cascade, template-folder migration, and restore's missing summary

## Context

Three existing call sites already produce (or should produce) compound revisions, each
with its own bespoke pattern:

1. `TemplateServiceImpl`'s editor-rename page-migration cascade (~lines 320-344):
   `Revision revision = revisionService.allocate(ctx.projectId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());`
   then a loop calling `close`/`insertVersion`/`appendSummary(page, revision)` once per
   affected page. Already correct in *outcome* (one revision, N pages, non-empty
   summary) — just not built on the shared `beginBatch`/`allocateOrJoin` mechanism.
2. `TemplateServiceImpl.ensureFoldersAndMigrate` (~line 466+, from `M13`): allocates one
   `MOVE` revision **per migrated template** in a loop, rather than one revision for the
   whole migration.
3. `ProjectRestoreService.restoreTo` (`server/sf-domain/.../revision/ProjectRestoreService.java:27-71`):
   allocates one `RESTORE` revision, then writes new/closed `AssetVersion` rows directly
   for every affected asset — but never calls `revisionService.appendSummary`. Its
   `summary.assets` is always `{"assets":[]}`, so today a project rollback's diff view
   and revision-list row look empty/misleading despite being a genuinely compound
   change.

## Goals

- Rewrite the editor-rename cascade to call `revisionService.beginBatch(ctx.projectId(), ChangeType.UPDATE, ctx.comment(), ctx.userId())`
  once, build a joined `RevisionContext`, and use `allocateOrJoin`/`appendSummary`
  consistently with the pattern established in `M15.2.1` — same outcome, now on the
  shared mechanism instead of a hand-rolled duplicate of it.
- Change `ensureFoldersAndMigrate` to open **one** `MOVE` batch for the whole migration
  run (all templates being reparented into their fixed folders in one maintenance
  pass) instead of one `MOVE` revision per template, using `beginBatch`/`allocateOrJoin`
  the same way.
- Fix `ProjectRestoreService.restoreTo`: after `assetVersionRepository.save(restored)`
  (the "target != null and not deleted" branch) and after `assetVersionRepository.save(deleted)`
  (the "asset no longer exists at target revision" branch), call
  `revisionService.appendSummary(projectId, newRevision, AssetChange.create(...))` with
  the correct `action` (`"RESTORE"` for the first branch, `"DELETE"` for the second) and
  the asset's `uuid`/`assetType`/`uid` — resolved from the `Asset` this method already
  has access to via `assetId` (add an `AssetRepository` lookup or thread the `Asset`
  through the existing `current`/`target` maps if cheaper).

## Acceptance criteria

- [x] The editor-rename cascade and template-folder migration both use
      `beginBatch`/`allocateOrJoin` instead of a raw `allocate` call, with identical
      externally observable behavior (same number of resulting revisions: 1 for the
      whole cascade, 1 for the whole migration run) plus, for the migration, *fewer*
      revisions than today (1 instead of N). (`ensureFoldersAndMigrate` turned out to
      already allocate exactly one revision for the whole run at the time of writing —
      re-verified against the current file per the task instructions — so no revision
      count changed there; only the mechanism it's built on changed.)
- [x] A new/updated `ProjectRestoreService` test asserts that after a project-wide
      restore touching M assets, the resulting revision's `summary.assets` has exactly
      M entries, each with the correct `uuid`/`type`/`action`. (New
      `ProjectRestoreServiceTest`; no prior test of this service existed.)
- [x] `UidChangeWarningIntegrationTest` and `TemplateFolderIntegrationTest` (or their
      successors) pass with revision-count assertions updated to reflect the new,
      lower counts where they previously counted per-template/per-page revisions.
      (Both already asserted the correct, already-batched counts; no assertion changes
      were needed.)
- [x] `./gradlew build` green.

## Out of scope

- `ProjectExportImportServiceImpl.importProject`'s bulk-`IMPORT` pattern — already
  correct (allocates once, appends per asset) and not touched by this task.
- Project creation — `M15.2.1`.

## Notes / hazards

- `ProjectRestoreService` doesn't currently receive a `RevisionContext` at all (it takes
  raw `projectId`/`userId`/`comment`) — decide whether to give it one for consistency
  with the rest of this milestone's mechanism, or leave it using `beginBatch` directly
  with its own raw parameters (it has no nested service calls to join the batch, unlike
  `ProjectServiceImpl.create`, so a full `RevisionContext` may be unnecessary machinery
  here — use judgment, but keep the *summary-population* fix regardless of which you
  choose).
- When resolving each restored/deleted asset's `uuid`/`type`/`uid` for the summary
  entry, prefer batching one query (e.g. `assetRepository.findAllById(...)` over the
  `all` id set) over N individual lookups inside the loop — `restoreTo` already iterates
  every touched asset once; don't turn that into two full passes with N extra queries
  each when one prefetch covers it.
