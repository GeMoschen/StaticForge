---
id: M29.4.2
status: todo
depends: [M29.4.1, M29.2.2]
epic: m29-housekeeping-jobs
feature: revision-compaction
area: backend
---

# M29.4.2 — Compaction algorithm and `revision-compaction` job

## Context

- `AssetVersion` (`valid_from_revision` inclusive, `valid_to_revision` exclusive, null = open; `deleted`) and
  `AssetVersionRepository`.
- `AssetReference` (revision intervals) and `ReferenceMaterializer`.
- `asset_release` (`M27.1.1`: `released_version_id`, open and closed rows, per locale).
- `scheduled_action` PINNED params (`M27.4.x`: the pinned version ids).
- `TargetWriter.retainedRunIds()` (`M29.3.1`, or add it here if this lands first) and `readManifest` (revision,
  consistent revision).
- `JdbcRevisionCounterRepository` (`SELECT … FOR UPDATE` on `project_revision_counter`, `:36`).
- `RevisionInvariantsTest` and `ConcurrentWritersTest` (`sf-app/src/test/java/com/acme/staticforge/`).
- Uid history as used by `RebuildExpansion.changesSince`.
- Epic decision 13.

## Goals

- **`RevisionCompactor`** (sf-domain, package `revision.compaction`): `compact(projectId, cutoffInstant, dryRun,
  JobContext)` → `CompactionResult` (assets touched, versions removed, references rewritten, revisions marked, bytes of
  payload freed, sample).
  1. **Protected set** P (version ids):
     - (a) `released_version_id` of every `asset_release` row of the project, open or closed;
     - (b) for each retained build of each target of the project: the versions valid at the manifest's revision and at
       its consistent revision (`findSnapshot` ids);
     - (c) the pinned version ids of `PENDING`/`RUNNING` scheduled actions.
  2. **Candidates.** Closed versions whose `valid_from_revision`'s `created_at` < cutoff, grouped per asset and per UTC
     day of that `created_at`, ordered by `valid_from_revision`.
  3. **Survivors per group.** Every version in P, and the last version of the day. Every other version is *removed*
     and absorbed by the **next survivor in the same day**: the survivor's `valid_from_revision` becomes the removed
     run's first `valid_from_revision`. Intervals stay contiguous and gapless.
  4. **References.** For the asset, `asset_reference` rows are rewritten so that the edges valid at every revision in
     an absorbed interval equal the survivor's edges: delete rows whose interval lies entirely inside removed
     intervals, and move the survivor's rows' `valid_from` back to the absorbed start. Rows spanning a boundary are
     split or trimmed, keeping the invariant "edges at R = edges materialized from the version valid at R". Verify
     against `ReferenceMaterializer` in tests.
  5. **Uid history.** If uid changes are derived from versions, the absorbed interval takes the survivor's uid. Check
     how `RebuildExpansion` reads uid history and keep baselines correct (P(b) protects baseline revisions).
  6. **Mark revisions.** `revision.compacted = true` for each R that was the `valid_from_revision` of a removed
     version. Advance `project.compacted_through`.
- **Batches.** Per ≤ `batchAssets` (default 200) assets, in one transaction that first takes the project's revision
  counter row lock (`FOR UPDATE`), so no revision allocation interleaves and no write sees a half-rewritten asset.
  Between batches, check for cancellation.
- **Job `revision-compaction`** (default `0 3 * * 0`, settings `batchAssets`, dry run):
  - For every non-archived project with an enabled policy, cutoff = now − `olderThanDays`. Report per project.
  - Audit `REVISIONS_COMPACTED` per project (counts in the detail, not in dry run).
  - A project without a policy is skipped silently.
- **Estimate.** `M29.4.1`'s estimate endpoint calls `compact(…, dryRun = true)`.

## Acceptance criteria

- [ ] **Unit fixture.** One asset with 5 versions on day D, where the 2nd is released (closed release row) and the 5th
      is the last of the day:
  - [ ] versions 1 → absorbed into 2, 3 and 4 → into 5;
  - [ ] reads at each original revision return the expected survivor;
  - [ ] no gaps or overlaps (query every revision).
- [ ] **Protected.** Versions of open and closed release rows (every locale), versions valid at a retained build's
      revision and at its consistent revision, and pinned schedule versions all survive.
- [ ] **Invariants** (extend `RevisionInvariantsTest` with a jqwik property: random histories over several days plus
      random releases, compacted with a random cutoff):
  - [ ] exactly one valid version per (asset, revision) for every revision;
  - [ ] reads outside compacted groups and at protected versions are byte-identical to before;
  - [ ] reads inside a group equal the group survivor;
  - [ ] references at R equal the references materialized from the version valid at R.
- [ ] **Builds.** A full build at a released or retained-build revision is byte-identical before and after compaction
      (golden comparison on a fixture project). An incremental build after compaction plans the same entries as before.
- [ ] **Concurrency.** `ConcurrentWritersTest`-style: 8 writers saving while the job compacts. No lost update, no
      deadlock, and the invariants hold afterwards.
- [ ] A dry run changes nothing and reports the same counts as the real run.
- [ ] Running the job twice is idempotent: the second run removes nothing new for the same cutoff.
- [ ] `./gradlew build` green.

## Out of scope

- Compacting `revision` rows or summaries (they stay).
- Compacting `audit_log` or run plans.
- Reads and UI (`M29.4.3`, `M29.5.2`).

## Notes / hazards

- **This is the only code path that rewrites history.** Guard it with `@RevisionAware`-style ArchUnit rules:
  `valid_from_revision` may only be decreased by `RevisionCompactor`. Add a rule or a test that fails if another
  class updates it.
- Open versions are never touched. A removable version whose next survivor in its day would be the **open** version is
  kept instead: absorbing into an open version would race with the next save. Such versions become compactable once a
  later save closes the open version. Document this and test it.
- When moving a survivor's `valid_from_revision` back, store its original value in `asset_version.original_valid_from`
  (`M29.4.1` schema) the first time. `M29.4.3` derives the read-side flag from it.
- Blobs referenced only by removed versions become unreferenced. The next `blob-sweep` collects them after its grace
  period. Test the hand-off.
- The M27 release rows reference `asset_version.id`. P(a) guarantees no FK breaks. Assert FK integrity in the test on
  PostgreSQL semantics (H2 in PostgreSQL mode).
