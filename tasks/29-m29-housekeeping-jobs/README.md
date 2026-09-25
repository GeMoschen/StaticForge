# M29 — Housekeeping jobs (system jobs, admin Jobs page, revision compaction)

**Spec:** Extends §7.7 (retention and compaction), §11.2 (blob store, nightly sweep), §18.4–§18.5 (builds, runs),
§11.4 (variant policy), §26.2 (search index), §26.3 (audit retention), §26.4 (observability), §26.5 (backup and recovery),
§26.6 (operations), §20.2 (REST catalogue: `/admin/jobs`), §23/§24 (admin area). Not part of the original §27 roadmap:
it is inserted the same way `M8`–`M28` were.

## Goal

Several parts of the system grow without limit or never recover on their own:

- Blobs are never freed.
- The audit log is never purged, and refresh-token rows pile up.
- A crash leaves a generation run `RUNNING` forever, which blocks every later build of that project.
- Failed builds leave staged output on disk.
- Media variants that failed to encode are never retried.
- Version history grows with every keystroke-level save.

The spec promises a nightly sweep, one-year audit retention and a compaction escape hatch, but none of them is built.

This milestone delivers:

- **A system-job framework** on M27's scheduler engine. Instance-level jobs have:
  - a cron schedule and an enabled flag;
  - settings, with defaults from `sf.housekeeping.*` that the admin UI can override and that are persisted;
  - a *Run now* action and a dry run for destructive jobs;
  - a run history, metrics and audit.
- **Core jobs:**
  - recovery of interrupted generation runs;
  - cleanup of orphaned build output;
  - a mark-and-sweep blob collector;
  - audit-log purge;
  - refresh-token cleanup;
  - eviction of in-memory maps.
- **Extended jobs:**
  - generation-run retention;
  - media variant backfill;
  - search-index maintenance.
- **Revision compaction** (spec §7.7), opt-in per project. Old versions collapse to the last version of each day.
  Nothing that a release, a retained build or a pending schedule depends on is ever lost.
- **Admin area "Jobs" page** with an optional project-settings toggle for compaction, and a "compacted" notice in time
  travel and diffs.

## Findings from planning (2026-09-25)

1. **No job infrastructure.**
   - There is no `@EnableScheduling`, `@Scheduled`, `TaskScheduler` or ShedLock.
   - The only periodic task is `SearchIndexServiceImpl`'s `ScheduledExecutorService` (`refreshAll`, every
     `sf.search.refresh-interval`).
   - M27 introduces `SchedulerEngine`, which claims work with a lease (`lease_owner`/`lease_until`, conditional
     `UPDATE`). That is the only multi-node-safe claim primitive the codebase will have.
2. **Blob `ref_count` is only ever incremented.**
   - The writers are `MediaServiceImpl.storeBlob` (`:634`, originals, variants and text-media writes) and
     `ProjectExportImportServiceImpl.importBlob`.
   - Nothing decrements it, so it can't decide collectability. `Blob.java:12-14`, `BlobStore.delete` and
     `007-media-blobs.xml` call the sweep "out of scope".
   - Blobs are written before the asset version commits (spec §26.5). A failed commit (validation `422`, rollback,
     crash) or a failed import therefore leaves bytes in the store and sometimes a `blob` row that no version references.
3. **Every blob reference lives in `asset_version.payload`.** That covers `blobSha256` and `variants[].blobSha256`.
   M27 adds per-locale files for localized media (see `M27` feature 3 for their payload key).
   `generation_run.log_blob_sha` is never set.
4. **Interrupted runs block the project forever.**
   - `GenerationService` runs builds on an in-memory virtual-thread executor. Its state is held only in memory:
     `idempotencyKeys` and `emittersByRun` (`GenerationService.java:112-115`).
   - After a crash or restart, `QUEUED`/`RUNNING` rows stay as they are. `findActive` then answers
     `409 SF-GEN-0500` for every new run of that project until someone cancels manually.
   - `cancel` (`:228`) only flips the row to `CANCELLED`. `executeRun` never checks it: a cancelled run keeps
     rendering, publishes, and overwrites `CANCELLED` with `SUCCESS`/`PARTIAL` (`:486-496`).
   - M27 decision 27 makes scheduled generations wait for the active run to end, so a stuck row would also stall every
     schedule of the project.
5. **Orphaned build output.**
   - `fail()` (`:532`) never removes the staged `builds/{runId}` directory (filesystem) or `builds/{runId}.zip.tmp`
     (ZIP).
   - `FilesystemTargetWriter.prune()` (`:177`) counts failed runs' directories toward `keep-builds` like published
     ones, so failed builds displace real rollback points.
   - `promote` only checks `Files.isDirectory`, so a failed run's partial directory can be promoted.
   - A crash between creating and moving `.current-*.link` leaves the temporary link behind.
   - Deleting a target (`TargetController.delete`) removes only the row; its `{output-root}/{project}/{path}`
     directory stays forever.
6. **Audit log.** `AuditService` Javadoc: "There is no purge job: the one-year retention of §26 is not enforced yet".
   Actions are free strings; `actions()` reads distinct values from the DB, and the UI labels them in
   `admin-audit.util.ts`.
7. **Refresh tokens.**
   - Rotation marks the presented row `revoked` and inserts a new one (`RefreshTokenService.rotate`).
   - Rows are deleted only per family (reuse, expiry on presentation, logout) or per user.
   - Revoked rows of a live family are **needed**: presenting one is how reuse is detected. So only whole families
     past `absolute_expires_at`, or families whose every row is expired, may go.
8. **In-memory growth.**
   - `LoginAttemptService.buckets` removes a key only on a successful login (`:89`), so failed attempts from many
     IPs or usernames accumulate.
   - `GenerationService.idempotencyKeys` never shrinks.
9. **Generation runs.** `generation_run` rows are never deleted. Plan rows are pruned by `RunPlanStore.prune`
   (`sf.generate.plan-retention-runs`, default 50). `diagnostics` JSON stays on every row forever.
10. **Variants.**
    - `MediaServiceImpl.generateVariants` (`:495`) runs synchronously on upload.
    - A failed encode is logged and skipped (`:536`), and `webp` is always skipped for lack of an encoder.
    - The policy is instance-wide (`MediaProperties.variants`, `sf.media.variants`), although spec §11.4 says "per
      project".
    - Variants are stored **inside the version payload** and read in five places: `MediaController:489`,
      `MediaServiceImpl:348`, `ProjectExportImportServiceImpl:1156,1277`, `GenerationRenderer:478` and
      `AssetCopyStage:108`.
    - A backfill that rewrote payloads would need a revision per media asset and, after M27, would turn every
      published media asset into a `CHANGED` draft.
11. **Search.** `SearchIndexer.sync` compares the index's revision stamp with the head and replays or rebuilds
    (`:295-309`). Nothing checks document counts, merges segments, or re-syncs a project whose after-commit event was
    lost (e.g. the node died between commit and indexing) until the next restart's catch-up.
12. **Revision compaction doesn't exist.**
    - There is no `revision.compacted` column (the spec only reserves it).
    - `sf.revision.retention-days: unlimited` (`application.yml:78`) is read by nothing.
    - `RevisionInvariantsTest` (jqwik) asserts exactly one valid version per (asset, revision) and byte-identical
      point-in-time reads.
    - `DiffServiceImpl` diffs a revision's touched assets against `r-1`.
    - `RebuildExpansion` reads baseline versions with `findValidAtRevisionByAssetIdIn`, so an inexact baseline would
      produce a wrong incremental plan.
    - The revision counter is locked with `SELECT … FOR UPDATE` on `project_revision_counter`
      (`JdbcRevisionCounterRepository:36`).

## Decisions (binding for all tasks — revisit only with the user)

1. **Jobs run on M27's engine.** M29 adds instance-level *system jobs* next to project *scheduled actions*.
   - Same lease primitive: if `M27.4.1` bound it to `scheduled_action`, generalize it here and don't copy it.
   - Same poll tick, same virtual-thread execution.
   - A job never runs twice at the same time, on any node.
2. **Model.**
   - `system_job` holds `key` PK, `enabled`, `cron`, `zone_id`, `settings` json, `next_run_at`, the lease columns,
     `last_run_id` and `version`.
   - `system_job_run` holds `id`, `job_key`, `trigger` (`SCHEDULE|MANUAL|STARTUP`), `dry_run`, `started_at`,
     `finished_at`, `outcome` (`SUCCEEDED|FAILED|PARTIAL|SKIPPED`), `items_examined`, `items_affected`,
     `bytes_freed`, `message`, `report` json (a bounded sample) and `started_by` (null for the system).
   - The SPI is `HousekeepingJob`, with `key()`, `defaults()`, `validateSettings(json)`, `supportsDryRun()`,
     `run(ctx)` and `runOnStartup()`.
   - Changelog `024-system-jobs.xml`. Run history is capped per job (`sf.housekeeping.history-per-job`, default 200).
3. **Settings precedence.**
   - Each job's defaults come from `sf.housekeeping.<job>.*` (`HousekeepingProperties`).
   - The first start seeds a `system_job` row from them. After that the persisted row wins, and the admin UI edits it.
   - *Reset to defaults* copies the properties again.
   - The cron zone defaults to `sf.housekeeping.zone` (default `UTC`) and is shown in the UI.
4. **Destructive jobs support dry run.** These are blob sweep, audit purge, build-output cleanup, generation-run
   retention and revision compaction. A dry run reports what would be removed (counts, bytes, a sample of up to 50
   items) and deletes nothing. There is no "confirm dry run first" gate.
5. **Audit.**
   - `JOB_SETTINGS_SET` records a changed schedule or settings (before/after in the detail) and `JOB_RUN` records a
     manual *Run now*. Both are instance-level entries.
   - Scheduled runs go to `system_job_run` only, to keep the audit log free of noise.
   - Compaction adds the project-level `COMPACTION_POLICY_SET` and `REVISIONS_COMPACTED` (counts in the detail).
6. **Metrics.**
   - `sf.job.duration{job,outcome}`, `sf.job.items{job,kind=examined|affected}`, `sf.job.bytes.freed{job}`.
   - The gauge `sf.job.last.success.age{job}` (seconds) drives the §26.4 alert "housekeeping stale".
7. **Jobs and default schedules** (all enabled by default except `revision-compaction`, which is enabled but acts only
   on projects that opted in):

   | Key | Default | What it does |
   |---|---|---|
   | `generation-run-recovery` | startup + `*/5 * * * *` | Interrupted `QUEUED`/`RUNNING` runs → `FAILED` (`SF-GEN-0504`) |
   | `build-output-cleanup` | `10 3 * * *` | Staged output of unpublished runs, stale temp links, dirs of deleted targets |
   | `blob-sweep` | `30 3 * * *` | Mark-and-sweep of the blob store, grace 24 h |
   | `audit-purge` | `0 4 * * *` | Audit entries older than 365 days |
   | `refresh-token-cleanup` | `15 * * * *` | Dead refresh-token families |
   | `memory-eviction` | `*/10 * * * *` | Login-limiter buckets, idempotency keys |
   | `generation-run-retention` | `15 4 * * *` | Runs older than 90 days, beyond the newest 50 per project, unprotected |
   | `media-variant-backfill` | `0 2 * * *` | Missing/failed variants, at most 500 per run |
   | `search-maintenance` | `0 5 * * *` | Sync, count check, merge; rebuild on mismatch |
   | `revision-compaction` | `0 3 * * 0` | Compacts opted-in projects |

8. **Blob sweep is mark-and-sweep.**
   - Mark: every blob hash referenced by any row of `asset_version` (all revisions, deleted versions included), from
     the original, each variant, localized media files (M27), the `media_variant` table (decision 10) and
     `generation_run.log_blob_sha`.
   - Sweep: blob rows and store objects not marked and older than the grace period (`created_at`, or the object's
     modification time for bytes without a row).
   - It also finds **store objects without a row** (orphan bytes from failed commits) by listing the store.
   - Consequence, to be documented: deleting or replacing media frees no space by itself, because history still
     references the old bytes. Space is freed once revision compaction (decision 13) removes the last version
     referencing them. The sweep mostly collects orphans (failed commits and imports) and compaction's leftovers.
   - `ref_count` is **recomputed** by the sweep to the number of referencing version rows and is documented as
     derived, not authoritative. No code path may use it to delete.
   - Blobs are content-addressed and immutable, so a blob re-uploaded during the sweep is protected by the grace
     period plus a re-check of the row's `created_at` right before deleting.
9. **Interrupted-run recovery.**
   - `generation_run` gains `executor_node` (the node id, `sf.node-id`, default hostname + pid) and `heartbeat_at`.
     The executing thread updates `heartbeat_at` at every stage and at least every 30 s.
   - At startup, every `QUEUED`/`RUNNING` run whose `executor_node` is this node is interrupted.
   - Periodically, any run whose heartbeat is older than `sf.housekeeping.generation-run-recovery.stale-after`
     (default 5 min), on any node, is interrupted.
   - Interrupted means: `FAILED`, diagnostic `SF-GEN-0504` "Run interrupted (node restart or lost heartbeat)", SSE
     emitters completed, staged output left to `build-output-cleanup`.
   - The same task makes cancel real: `executeRun` checks for cancellation between stages and aborts before
     `publish`. The final status is written with a compare-and-set on `status`, so a cancelled or recovered run is
     never overwritten to `SUCCESS`.
10. **Variants become derived data.**
    - A new table `media_variant` holds `source_sha`, `name`, `width`, `format`, `quality`, `blob_sha` and
      `created_at`, keyed by `(source_sha, name, width, format, quality)`.
    - One `MediaVariantResolver` merges payload variants (old versions keep working) with this table and replaces the
      five readers.
    - Uploads keep writing payload variants as today.
    - The backfill fills **only** the table. It writes no revision and creates no draft, so a variant policy change or
      a failed encode never touches content history.
11. **Generation-run retention.** A run is **protected** (never deleted) when:
    - its build is on disk in any target (every run id listed in `builds/`);
    - it is the `current` run of a target;
    - it is `QUEUED`/`RUNNING`;
    - it is the baseline of a retained build's manifest;
    - it is referenced by a `scheduled_action_execution` row younger than the retention.

    Otherwise a run is deleted when it is older than `keep-days` (90) **and** outside the newest `keep-per-project`
    (50) runs of its project. Its plan rows go with it.
12. **Search maintenance**, per non-archived project:
    - `requestSync` catches up any lag.
    - Compare the index's document count with the number of indexable current versions. On a mismatch, run
      `requestRebuild`.
    - `forceMerge` when deleted documents exceed 20 % of the index (`sf.housekeeping.search-maintenance.merge-deletes-pct`).
    - It never runs while a rebuild is in progress (`SF-SEARCH-0409` → `SKIPPED`).
13. **Revision compaction model** (spec §7.7, user decision 25):
    - **Opt-in per project** on `project.compaction_policy` json: `enabled`, `olderThanDays` (≥ 30), `enabledAt`,
      `enabledBy`.
      - Set with `PUT /projects/{key}/compaction` (`PROJECT_ADMIN`). Enabling requires `?confirm=<projectKey>`;
        disabling needs nothing.
      - Audit `COMPACTION_POLICY_SET`. No revision is recorded, because the setting doesn't affect output.
      - Refused on archived projects (M26 guard).
    - **Window.** A version is *in the window* when the `created_at` of its `valid_from_revision` is older than
      `olderThanDays` and the version is **closed**. Open versions are never touched. A removable version whose next
      survivor would be the open version stays until a later save closes it.
    - **Day.** A version's *day* is the UTC date of that revision's `created_at`. UTC is fixed and documented, because
      schedules follow the viewer's zone and there is no project time zone.
    - **Protected versions** are never removed:
      - (a) every version referenced by **any** `asset_release` row, open or closed, in any locale, so "what was live
        on date X" stays exact forever;
      - (b) every version valid at the revision of a build that is still on disk in any target (its manifest's
        revision and consistent revision), so incremental baselines stay exact;
      - (c) every version pinned by a `PENDING`/`RUNNING` scheduled action (`PINNED` release/unpublish);
      - (d) the last version of each day for each asset.
    - **Absorb into the next survivor of the same day.** Within one asset's day, an unprotected version is deleted and
      its interval is absorbed by the next surviving version of that day, whose `valid_from_revision` moves back.
      - A read at any revision therefore returns the state at the end of that group.
      - For a whole day, every asset shows its end-of-day state, so the project snapshot equals the exact snapshot at
        the day's last revision (or at the next protected point).
      - Tombstones (`deleted=true`) take part like any version.
    - **References.** `asset_reference` rows of the asset are rewritten so that, for every revision in the absorbed
      interval, the edges equal those of the surviving version. Invariant: edges at R equal the edges materialized from
      the version valid at R.
    - **Revisions stay.** Rows, summaries, authors and comments are kept. `revision.compacted = true` marks each
      revision whose own changes were absorbed (some removed version had `valid_from_revision = R`). Project
      `compacted_through` records the newest revision compaction has processed.
    - **Reads.**
      - Time travel to a compacted revision works and returns the surviving version. API responses carry
        `compacted: true` (exact per asset via `asset_version.original_valid_from`), and the UI shows a notice.
      - The diff of a compacted revision returns the summary's asset list with `compacted: true` per asset whose change
        was absorbed, and no field diff: "Exact changes of this revision were compacted; the state at the end of the
        day is kept".
    - **Locking and scope.**
      - Compaction runs in per-asset batches. Each batch holds the project's `project_revision_counter` row lock
        (`FOR UPDATE`), so no revision is allocated concurrently.
      - Batches are short (default 200 assets) so saves wait milliseconds, not minutes.
      - It writes no revision. Archived projects are skipped.
      - Blobs freed by removed versions are collected by the next `blob-sweep`.
14. **Error codes.** `SF-DOM-0180` invalid job settings/cron (`422`, `errors`), `SF-DOM-0181` job already running
    (`409`), `SF-DOM-0182` compaction confirmation missing or wrong (`422`), `SF-DOM-0183` `olderThanDays` below 30
    (`422`), `SF-DOM-0184` unknown job (`404`). The generation diagnostic `SF-GEN-0504` is a planned exception: it is a
    run diagnostic, not a domain error, so it lives next to `SF-GEN-0500`–`0503`.

## Exit criteria (epic is done when)

- [ ] Killing the backend during a build and restarting it leaves the run `FAILED` (`SF-GEN-0504`) within one tick,
      and a new build of that project starts without manual cancel. Cancelling a running build really stops it (it
      never publishes).
- [ ] A dry run of every destructive job reports counts, bytes and samples and deletes nothing. A real run deletes
      exactly what the dry run reported, when nothing changed in between.
- [ ] Blob sweep:
  - [ ] removes blobs only reachable from nothing, including orphan bytes of a failed upload and of a rolled-back
        import;
  - [ ] never removes a blob referenced by any version of any revision, by a variant or localized file, or created
        within the grace period (tests on filesystem and S3 stores).
- [ ] Audit entries older than the retention and dead refresh-token families are purged. Refresh-token reuse
      detection still works for live families.
- [ ] Failed runs' staged output, stale `.current-*` links and deleted targets' directories are removed. Rollback
      points (`keep-builds`) count only published builds.
- [ ] Generation runs are retained per decision 11. Promote and incremental baselines still work after retention ran.
- [ ] A failed or missing variant is created by the backfill without a revision, and generation uses it.
- [ ] Search maintenance repairs an index with a missing document (count mismatch → rebuild) and a lost after-commit
      event (lag → sync).
- [ ] Revision compaction, opted in on a fixture project with 30+ days of history:
  - [ ] removes versions per decision 13 and keeps every protected version;
  - [ ] extended `RevisionInvariantsTest` holds: one valid version per (asset, revision); exact reads outside
        compacted groups and at protected versions; end-of-group state inside;
  - [ ] a rebuild at a released revision is byte-identical before and after compaction;
  - [ ] time travel and diff show the compacted notice.
- [ ] The admin **Jobs** page lists every job with schedule, last/next run, outcome and history, and supports edit,
      *Run now*, dry run and *Reset to defaults*. Project settings offer compaction with a typed confirmation.
- [ ] Metrics `sf.job.*` are exposed, and the stale-housekeeping alert is documented.
- [ ] `./gradlew build` (`test --rerun`), `ui` `npm run build` and `npx vitest run` green; the Playwright journey is
      green.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [job-framework](01-job-framework/README.md) | backend | `M27.4.1` |
| 2 | [core-jobs](02-core-jobs/README.md) | backend | 1.1 |
| 3 | [extended-jobs](03-extended-jobs/README.md) | backend | 1.1 (3.1 also 2.1, 2.2) |
| 4 | [revision-compaction](04-revision-compaction/README.md) | backend | 1.1, `M27.1.1` |
| 5 | [ui](05-ui/README.md) | frontend | 1.2, 4.1, 4.3 (per task) |
| 6 | [docs-e2e](06-docs-e2e/README.md) | qa | 1–5 |

Features 2, 3 and 4 can run in parallel once `M29.1.1` is done: each job lives in its own package. `M29.1.2` (admin
API) is needed only by the UI.

## Dependencies

- `M27`: `SchedulerEngine` and its lease claim (`M27.4.1`), `asset_release` (`M27.1.1`), pinned scheduled actions
  (`M27.4.x`) and localized media files (`M27` feature 3).
- `M26`: the admin area, `AdminUserController` pattern, audit search, archived guard.
- `M22`: build manifests, `RunPlanStore.prune`.
- `M23`: `SearchIndexer`.
- `M7.3`: audit log.

## Notes

- **API shape.**
  - Admin endpoints go under `/api/v1/admin/jobs/**` with class-level `hasAuthority('SYS_INSTANCE_ADMIN')`, like the
    other `Admin*Controller`s.
  - Project compaction goes under `/projects/{key}/compaction` with `@projectAuth` `PROJECT_ADMIN`.
  - Regenerate OpenAPI and `ui/src/app/core/api/generated/schema.d.ts` after each backend task that changes the API.
- **Single node today.** `GenerationService` and the search index remain single-node (§26.2). The heartbeat and lease
  make recovery correct with several nodes, but running several nodes is not an M29 goal.
- **Not in scope:**
  - project deletion;
  - S3 build pruning (the `S3TargetWriter` is a local-mirror stub; its cleanup follows when it becomes real);
  - a per-project variant policy (spec §11.4 says per project; still instance-wide, noted in the spec);
  - backup automation (§26.5 stays an ops runbook);
  - email alerts;
  - compaction of `generation_run_plan_*`, beyond run retention deleting them.
- **Spec follow-up** (in `M29.6.1`):
  - §7.7 (implemented model, protected versions, UTC days);
  - §11.2 (mark-and-sweep, `ref_count` derived);
  - §11.4 (`media_variant`);
  - §18.4/§18.5 (heartbeat, interrupted runs, real cancel, `keep-builds` counts published builds);
  - §20.2, §26.3 (audit retention enforced), §26.4 (metrics, alert), §26.5 (sweep and compaction vs. restore
    drills), §26.6 (Jobs page);
  - Appendix B (codes).
