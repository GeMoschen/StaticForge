# M27.8 — Schedules in archives, protocol 9 (branch `m27-8-schedule-export`)

Spec: `tasks/27-m27-release-and-scheduling/08-schedule-export/`. Decisions 1–9 there (with the user, 2026-09-26).

- [x] M27.8.1 — changelog 024 (schedule + target uuid), entity/repo/views
- [x] M27.8.1 — `ReleaseServiceImpl.plan` `noRollbackFor`; `ScheduleService.importAction` (validates a detached copy, returns refusals)
- [x] M27.8.1 — export: `schedules/<uuid>.json`, `includeSchedules`, target uuid in settings
- [x] M27.8.1 — import: settings by uuid, `importSchedules`, analysis warnings, result counts; API + OpenAPI
- [x] M27.8.1 — `ScheduleExportImportIntegrationTest` (7 tests covering T1–T14; protocol-8 archive rewritten in the test), existing tests updated
- [x] M27.8.2 — export checkbox, import option, warnings, vitest
- [x] M27.8.3 — docs
- [x] `./gradlew build test --rerun` (1338 tests, 0 failures, 6 skipped benchmarks), `npm run build`,
      `npx vitest run` (90 files, 603 tests); manual check on the dev stack

## Review

- **Backend.** `ScheduleArchive` (new, package-private) carries all schedule logic; the export/import service only
  wires it in. `ScheduleService.importAction` validates each schedule like a create (as its owner) on a detached copy
  and returns refusals instead of throwing. `ReleaseServiceImpl.plan` no longer dooms a caller's transaction when it
  refuses (`noRollbackFor`): without it one invalid schedule rolled back the whole import (two tests fail without it).
  Changelog `024` adds `uuid` to `scheduled_action` and `generation_target` (PostgreSQL backfill reviewed, not
  testable here: no PostgreSQL on this machine).
- **UI.** Export: "Include schedules". Import: a "Schedules" choice when the archive has any, schedule warnings
  without the asset provenance badge, and the commit-time outcomes under the result.
- **Manual check** (clean dev DB, Playwright script): a project with a pinned release + then-generate and a recurring
  generation exported with targets and schedules; imported into a second project — both schedules pending, the target
  resolved by uuid, pin drift 0, the recurring one at its next 03:00 Berlin slot; re-import lists "Replaces schedule
  #…" for both, and "Don't import schedules" drops those warnings. Two polish fixes came out of the screenshots:
  readable labels ("Release at 2026-09-28 11:39 UTC …") and no "explicit" badge on schedule warnings.
- **Deviation:** the protocol-8 case is an archive rewritten in the test, not a frozen fixture directory.


---

# Generation run comment (follow-up to M27, branch `m27-release-and-scheduling`)

A run's comment was passed to generation but never stored. This affected manual runs (the dialog's "Optional note
for this run") and the notes schedules give their runs (M27 deviation, decision 21).

- [x] `generation_run.comment` (changelog `023`, `VARCHAR(500)`). `GenerationService.start` stores the trimmed
      comment; blank means none, and a longer one is cut to 500 characters ending in "…", like a revision comment.
- [x] `GenerationRunView.comment`; OpenAPI + `schema.d.ts`; the Generation runs table shows it under the mode.
- [x] Tests:
  - `BuildInsightApiTest.aRunKeepsTheCommentItWasStartedWith` covers start, read, history, blank and too long.
  - `ScheduledActionsIntegrationTest` covers "Scheduled generation #n: nightly" and "After scheduled release #n".
  - `generation.component.spec.ts`.
- [x] Spec §18.5, `docs/api.md`, and the M27 deviation note marked resolved.
- [x] `./gradlew build test --rerun` (1329 tests, 0 failures, 6 skipped benchmarks), `npm run build`,
      `npx vitest run` (90 files, 598 tests)


---

# M27.7 — Docs and journey (branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/07-docs-e2e/`. 7.1 (docs, agent) and 7.2 (journey, me) in parallel.

- [x] M27.7.1 — spec §2.2, §5, §7, §10.4/5, §11, §16.4, §17, §18.1/2, §19, Scheduler section, §20.2, §23/§24,
      §26.2/4/5, Appendix B/C; `docs/api.md`, `user-guide.md`, `template-developer-guide.md`, `administration.md`,
      `architecture.md`, `infra/README.md`, `release-readiness.md` §4; deviations recorded
- [x] M27.7.2 — `ui/e2e/m27-journeys.spec.ts`, the 10 steps, self-seeding, 1280 px assertions
- [x] Journey green twice on a clean dev stack (scheduler poll 2 s); defects fixed with a test each
- [x] `./gradlew build test --rerun` (1328 tests, 0 failures, 6 skipped benchmarks), `npm run build`,
      `npx vitest run` (89 files, 597 tests)


## Review

- **Docs (7.1)**, written by a parallel agent against the code:
  - Spec: new subsections §5.5 (release state), §11.6 (localized media) and §18.7 (scheduler). No existing number
    moved.
  - Updated §2.2, §7, §10.4/5, §16.4, §17–§19, §20.2, §21, §23/§24, §26.2–§26.5, §27, and Appendix B/C.
  - API reference, user guide, template developer guide, administration, architecture, infra README and release
    notes.
  - Every deviation from the epic decisions, with its reason, is in `07-docs-e2e/001-docs-and-spec.md`.
  - Correction from checking the code: `SF-GEN-0221` covers links only. A value read from an unreleased asset
    renders empty with `SF-TPL-0112`, like a deleted one.
- **Journey (7.2)**:
  - All ten steps pass through the UI, including builds, localized media on disk, a pinned scheduled release with
    then-generate, a cron schedule, deletion, export/import and the `EDITOR` view.
  - Green twice in a row on a clean stack.
  - Several failed runs were script errors: the Windows `current` pointer file, server-normalized images, a step
    that didn't reopen the editor after a build, and the media drawer left open.
- **Defects found and fixed, each with a test:**
  - `CHANGED` over an empty diff, from `null` vs absent fields in the locale projection (`LocaleProjectionTest`).
  - Drift shown after a schedule ran (`schedules.component.spec.ts`).
  - One-off times inside a DST gap resolved differently from cron slots (`zoned-time.util.spec.ts`; spec §18.7
    states the rule).


---

# M27.6 — UI: release status, release bar, Changes, preview toggle, localized media, Schedules (branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/06-ui/`. Order 6.1 → 6.5 → 6.2; 6.3 and 6.4 in parallel (separate agents,
separate feature folders).

Design (beyond the task text):
- New `features/release/`: `ReleaseService` (plan/release/unpublish/discard + changes API), `release-status.util`
  (labels, status for the editing locale with `""` fallback, tooltip text), `ReleasePermissionsStore` (`canRelease()`:
  role ≥ `DEVELOPER` and not read-only — the one place M28 swaps), `ReleaseEventsStore` (a counter bumped after every
  release/unpublish/discard/schedule action; lists, the nav-rail count and release bars refresh on it — no polling).
- `sf-release-badge` takes the DTO's `release` + `scheduled` blocks and reads the editing locale itself.
- `sf-release-bar` loads its own state with `GET /assets/{uuid}` (the generic detail carries `release`/`scheduled` for
  every releasable type) and re-loads on `refreshKey` (the editor's saved revision) and on release events — one data
  source, never computed client-side, and one integration line per editor.
- Dialogs follow the `design/_dialog-shell` pattern (scrim + panel, Escape closes).
- Routes stay eager like every other project route (decision of 2026-09-16 in `app.routes.ts`), not lazy.

- [x] API client: releases, changes, schedules, preview `view`, media localized/files/text locale
- [x] M27.6.1 — badge, release bar, release/unpublish/discard dialogs, permissions store; bar in every releasable
      editor; badges in pages tree/list, content, globals, media, navigation; delete confirmation texts
- [x] M27.6.5 — schedule dialog (time zones, cron presets, preview times, pin/missed/then-generate, dependencies),
      Schedules page (filters, actions, history drawer), bar "Schedule…" + pending-schedule line, nav-rail entry
- [x] M27.6.2 — Changes view (URL filters as chips, paging, sort, diff panel, multi-select actions, keyboard), nav-rail
      count badge
- [x] M27.6.3 — preview Draft/Published toggle, not-published empty state, status line, share view (agent)
- [x] M27.6.4 — localized media drawer, files section, text locale, library marker/thumbnail (agent)
- [x] Backend additions the UI needed: `GET /media/{uuid}` (per-language files resolved server-side),
      `ownerUserId` on `scheduled` refs; OpenAPI + `schema.d.ts` regenerated
- [x] `npm run build`, `npx vitest run` (89 files, 596 tests); `./gradlew build test --rerun` (1327 tests, 0 failures,
      6 skipped benchmarks); manual check in the running app (dev stack on scratch ports)


## Review

- **Delivered as specified**, with these design choices:
  - One data source for statuses: the DTO `release` blocks. The release bar reads its asset itself
    (`GET /assets/{uuid}`) and again after every save and every release action. Lists re-read on release events.
    A row shown elsewhere is patched right away with the status the bar just read (`ReleaseEventsStore.observed`),
    so the tree shows "Changed" as soon as the editor saved.
  - Permissions sit in `ReleasePermissionsStore` (one computed per operation, `DEVELOPER` + not read-only) so that
    M28 changes a single class.
  - Routes `changes` and `schedules` are eager, like every other project route (the 2026-09-16 single-bundle
    decision), not lazy as the task text says.
- **Backend additions the UI needed** (instead of copying server logic into the UI):
  - `GET /media/{uuid}` returns `MediaView` with `localeFiles`. The media agent had first re-implemented
    `MediaFiles.fileFor` in TypeScript for drawers opened from list rows; that copy is gone.
  - `ownerUserId` on `scheduled` refs, so the bar can say "Release scheduled for … by Ana" without one request per
    schedule.
- **Fixed on the way (pre-existing, found by the manual check): history rewritten by page PATCH and section
  edits.** `BodyService` edited the stored version's payload in place. Content merge-patch and section add, reorder,
  delete and move therefore rewrote the *previous* version's row at flush. A released page that was edited through
  these endpoints stayed `PUBLISHED`, and the next build would have published the unreleased edit. Fixed at the root
  (deep copy). `PagePayloadHistoryIntegrationTest` fails on the old code and passes now. See `lessons.md`.
- Also fixed: the media library's thumbnail cache never refreshed after a file was replaced. It is keyed by
  revision now, which matters more now that a language can get its own file.
- **Manual check** (scratch stack 8082/4301, Playwright at 1280 px, screenshots checked):
  - Release: NEW → release dialog → Published, with the tree badge and the nav-rail count updated.
  - Per language: an EN edit makes EN Changed while DE stays Published. Preview Draft shows the edit, Published
    shows the old text, per language. Discard restores the text in the editor and the preview.
  - Delete: deleting a published page makes it Deletion pending. Releasing the deletion from the Changes view
    (keyboard selection) removes it.
  - Schedule: a release 2 minutes ahead with then-generate ran on time ("4 s late"), and the page became
    Published. The history links revision r23, and generation run #1 opens expanded.
  - Localized media: toggle, EN upload, the thumbnail follows the editing language, EN released alone. Turning
    localization off lists the file to discard first.
  - Preview "Not published in Deutsch" and the share view choice.
  - 220 changes: 5 pages; paging, locale and search filters in the URL; select all on the page.


---

# M27.1.4 — Release performance for large selections (branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/01-release-model/004-release-performance-large-selections.md`. Backend.

- [x] `ReleaseBenchmark` (`SF_PERF`): Changes list, plan and release timed separately with statement/flush/load counts
- [x] Baseline, 5,000 pages × 2 locales = 10,101 items: release 328.7 s / 40,224 statements, plan 2.5 s / 40,222
- [x] Fix: bulk `resolve`, per-call completeness checker (`PageContentValidation.Session`), layered dependency walk,
      batched pointer close
- [x] After: release 1.8 s (reads ~44 + one insert per pointer), plan 1.0 s / 40 statements
- [x] `ReleaseQueryCountIntegrationTest` (bounded reads; refusal writes nothing), fails on the old code
- [x] Full `./gradlew build` (`test --rerun`)


## Review

- Cause confirmed by measurement: ~4 queries per item, and in the read-write release transaction each query
  auto-flushed with a dirty check of everything loaded so far — quadratic. Plan (read-only) ran the same queries in
  2.5 s. Fixed by removing the per-item queries; no flush-mode change.
- Pointer inserts stay one statement each (`IDENTITY` ids); the whole 10,101-item release, inserts included, takes 1.8 s.


---

# M27 feature 5 — Export/import protocol 8 (implementation, branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/05-export-import/`. Order 5.1 (backend) → 5.2 (UI).

Design (beyond the task text):
- `ExportedAsset` gains `release: [ExportedRelease]` (open pointers) and `draftDeleted`. `ExportedRelease` =
  `{locale, state: DRAFT_EQUALS | PAYLOAD | UNPUBLISHED, uid?}` plus, for `PAYLOAD`, the released version's payload, display name,
  parent folder uuid, folder path, template uuid, MIME type and size. `uid` only when the released uid differs from
  the asset's. `DELETION_PENDING` assets (deleted draft, open pointer) are exported with the tombstone as the draft.
- Media blobs: export/import walk `localeFiles` and released payloads too.
- Import `KEEP`: every distinct released `PAYLOAD` becomes one extra version of the asset *closed in the import
  revision* (`validFrom = validTo = R`: never the version valid at any revision, so "at most one valid version" holds
  and nothing but the pointer reads it); pointers open in the import revision (one revision, hazard note). Released
  payloads get the same remap + `origin` as the draft, so the per-locale projections — and statuses — match the
  source. Released folder paths are rebased from archive paths to target paths (longest imported-folder prefix).
- Locale keys: an entry is kept when its key is one the asset has in the target (effective config: the target's
  locales, or the archive's when the import brings them); `""` → every target locale; anything else is
  `RELEASE_LOCALE_MISSING` (warning, one per asset, pointer dropped).
- An overwritten asset: `KEEP` replaces the target's open pointers with the archive's (import wins); `DRAFT` leaves
  them alone (the live site is untouched by a draft import). Skipped implicit assets: untouched. `DRAFT` skips
  deletion-pending assets (a tombstone is not a draft).
- Analysis: `ConflictReport` gains `releaseState` (archive carries it) and `releaseMode` (the effective default);
  protocol ≤ 7 adds an `INFO` entry `ARCHIVE_WITHOUT_RELEASE_STATE` (new severity `INFO`).
- Import is a restore, not a release: no completeness gate.

- [x] M27.5.1 — protocol 8 export/import, `releaseMode` option (API param), analysis fields, `RELEASE_LOCALE_MISSING`,
      protocol-7 fixture; tests: round trip (statuses + identical full build), `DRAFT`, protocol 7, missing locale
- [x] M27.5.2 — import dialog: release-state radios / protocol ≤ 7 note, `releaseMode` sent; vitest
- [x] OpenAPI + `schema.d.ts`; full `./gradlew build` (`test --rerun`), `ui` `npm run build` + `npx vitest run`;
      manual check in the running app


## Review

- As planned, plus two additions found by the tests:
  - **`UNPUBLISHED` entries.** Open pointers can't tell `UNPUBLISHED` from `NEW`. The round-trip test failed on this, so
    the archive also lists locale keys that were released once. An import writes each one as a pointer opened and
    closed in the import revision (history only).
  - **Reference edges of imported released versions.** `asset_reference` has one edge set per asset and revision. An
    imported released version therefore got its draft's edges, so the incremental planner missed pages whose released
    version alone referenced a newly released asset. `RebuildExpansion` now extracts those versions' edges from their
    payloads. A test proved the gap first (empty plan).
- Decisions to confirm: `KEEP` over an existing asset replaces the target's release state with the archive's (import
  wins); `DRAFT` leaves it alone and skips deletion-pending assets. An import is a restore, so there is no
  completeness gate. Other missing locales are a warning.
- Changed after review (user): a `""` (all languages) pointer releases only the target languages the archive has;
  the manifest now lists the archive's languages (`locales`). An archive without languages counts as the target's
  default language: its pointers release that language only.
- **Fixed on the way (pre-existing, M27.4):** `ScheduledActionsIntegrationTest.busyProject` failed 2 of 3 runs, on
  master too. In its last tick the one-off and the coalesced hourly generation are both due. A project runs one
  generation at a time (epic decision 27), so whichever starts second waits, and closing the engine then recorded
  `SKIPPED`. The product behaves as decided, but the test assumed both start in one tick. It now ticks until both have
  started, awaiting each run in between. It passed 5 of 5 runs after the fix.
- Verification: `./gradlew build test --rerun` green: 1321 tests, 0 failures, 5 skipped benchmarks. `ui` `npx vitest run`: 79 files, 540 tests. Manual
  check on a scratch dev stack (8082/4301): with a protocol-8 archive the radios show `KEEP` as default. Switching
  re-analyzes with `DRAFT`. Committing `KEEP` kept 2 releases, and only the never-released page appears in Changes.
  With the protocol-7 fixture the UI shows the note and no radios, and the import succeeds.


---

# M27 feature 4 — Scheduler (implementation, branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/04-scheduler/`. Backend only; order 4.1 → 4.2/4.3 → 4.4.

Design (beyond the task text):
- `sf-domain/scheduler`: tables + entities, `LeaseClaimer` (reusable conditional-update claim/extend, JDBC),
  `ScheduleTiming` (cron normalize, zone, DST via `CronExpression` on `ZonedDateTime`), SPI
  (`ScheduledActionHandler`, `ActionSpec`, `ActionRequirements`, `ExecutionContext`, `ExecutionResult`),
  `ActionAuthority` (DB-read owner/caller check of a handler's requirements — API and engine share it),
  `SchedulerEngine` (plain class, `tick()` returns a future; tests build their own engines with a mutable clock and
  node id), `ScheduleService` (API operations), side table `scheduled_action_asset` (the assets an action touches:
  `scheduled` on DTOs and the `assetUuid` filter in one indexed query).
- A handler that meets a busy project returns `WAITING`: the execution stays open with its progress in `detail`,
  the action returns to `PENDING` with `next_run_at` unchanged (due → retried every tick; later recurring slots
  coalesce). A re-claim resumes the open execution; release/run starts write their progress in the same
  transaction as the release revision / run row, so a retry never repeats a finished step.
- `RELEASE`/`UNPUBLISH` handlers in `sf-domain` (use `ReleaseService`), then-generate through the port
  `ScheduledGenerationStarter` implemented in `sf-generate` next to the `GENERATION`/`RECURRING_GENERATION` handlers.

- [x] M27.4.1 — `022-scheduler.xml`, entities/repositories, `SchedulerProperties`, `LeaseClaimer`,
      `ScheduleTiming`, SPI, `ActionAuthority`, `SchedulerEngine` (claim, missed policy, owner re-check, archived,
      audit, metrics, lease extension); tests: two engines × 50 actions, crashed lease, missed policies, DST, owner
      lost, archived
- [x] M27.4.2 — `RELEASE` (pin/latest, per-item skip, one revision, progress) / `UNPUBLISH` handlers, then-generate
      with busy wait, `ScheduleDrift`, re-pin; tests
- [x] M27.4.3 — `GENERATION` / `RECURRING_GENERATION` handlers (validation `0161`, owner start, idempotency key,
      busy wait/skip/coalesce, target gone `0162`); tests
- [x] M27.4.4 — `ScheduleController` + DTOs, `scheduled` on asset DTOs and Changes rows, audit, walk test,
      problems `0164`–`0168`, OpenAPI + `schema.d.ts`; MockMvc tests
- [x] Full `./gradlew build` (`test --rerun`), `ui` `npm run build` + `npx vitest run`


## Review

- Backend as planned. Design points beyond the task text are in each task's implementation notes. The engine is a
  plain class tests run with their own node ids and clocks. Handlers report `WAITING` for a busy project, and the
  execution stays open. Progress is checkpointed in the transaction of each step. The side table
  `scheduled_action_asset` answers `scheduled` in one query. The then-generate port lives in `sf-domain` and is
  implemented in `sf-generate`. Permissions come only from `handler.requirements`, for the API caller and for the
  owner at execution.
- Fixed or aligned on the way: a `LOCKED` instance admin may release (same rule as the owner check), and a `@Version`
  conflict at commit is `409 SF-API-0409` instead of a 500. `ReleasePermissions.canSchedule` was removed (unused).
  Asset DTOs' `scheduled` is now `ScheduledRefView[]`.
- `./gradlew build test --rerun`: 1312 tests, 0 failures (5 skipped benchmarks). New suites: `ScheduleTimingTest` (4),
  `SchedulerEngineIntegrationTest` (8), `ScheduledActionsIntegrationTest` (9), `ScheduleApiTest` (6) and
  `ProblemExceptionHandlerTest` (1). `ui` `npm run build` and `npx vitest run` (79 files, 536 tests) are green after
  regenerating `schema.d.ts`.


---

# M27 feature 3 — Localized media (implementation, branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/03-localized-media/`. Backend only; order 3.1 → 3.2.

- [x] M27.3.1 — `MediaFiles` (payload model: `localized`, `fileLocale`, `localeFiles`, `fileFor` along the chain),
      per-locale upload/replace/remove, `?locale=` on text/process/binary, toggle with `409 SF-MEDIA-0505` and pointer
      rekeying (carried like a system migration), projection per locale file, discard restores a locale's file,
      Changes candidates count localized media keys, DTO `localized`/`localeFiles`, problems `0505`–`0509`;
      fix: media versions written by metadata/process/text/restore writes lose the `mime_type` column
- [x] M27.3.2 — per-locale media outputs (`{localePrefix}assets/media/…`, own file or shared owner path, fallback
      copy when the owner doesn't publish it), references/processed media per render locale, manifest media locale,
      carry-forward per (media, locale), collision check, planner seeds locales that fall back to a changed locale,
      preview share URL serves the locale's file
- [x] OpenAPI + `schema.d.ts`; full `./gradlew build` (`test --rerun`), `ui` `npm run build` + `npx vitest run`


## Review

- Backend as planned, plus small API additions the UI (`M27.6.4`) will need: `?locale=` on binary, thumbnail,
  process and the rendered binary; `localized` on list rows; `localeFiles` (every language → the file it renders, own
  or from which locale) on the media view. Design details are in each task's implementation notes.
- Design beyond the task text: `fileLocale` pins the top-level file to its language (survives a change of the default
  locale); one `MediaOutputs` rule for links, copies and carry-forward (a fallback links the owner's published file,
  or writes its own copy when the owner doesn't publish one); the planner re-seeds locales that fall back to a locale
  whose release changed; media outputs in the manifest carry their locale; page-vs-media path collisions are
  `SF-GEN-0110`.
- Fixed on the way: media versions written by metadata/process/text/restore/move/migration writes lost the
  `mime_type` column (the library's MIME filter and image pickers dropped them); `replace` lost localized alt text and
  caption; the per-build and preview text-media compile caches were keyed by media only (would have mixed locale
  sources).
- `./gradlew build test --rerun`: 1283 tests, 0 failures (5 skipped benchmarks); late-edited classes re-run green;
  `ui` `ng build` (in the Gradle build) and `npx vitest run` (79 files, 536 tests) green.

---

# M27 feature 2 — Released rendering (implementation, branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/02-released-rendering/`. Backend only; order 2.1 → 2.2 → 2.3.

- [x] M27.2.1 — `SnapshotView`, per-locale released views in `Snapshot` (unreleased = absent marker, like a
      tombstone), bulk pointer + version load; consumers locale-aware (planner site outputs, output paths, renderer,
      navigation, values, pagination, carry-forward, media copy); `SF-GEN-0221`; URL registry assigns the snapshot's
      path; test helper that releases fixtures; golden/per-locale/time-travel tests; benchmark number
- [x] M27.2.2 — release-seeded incremental planning (`ASSET_RELEASED`/`ASSET_UNPUBLISHED` roots, released-version
      edges, migration seeds nothing), impact endpoint answers "if released", invariant tests
- [x] M27.2.3 — preview `view=draft|published`, one view abstraction, navigation at the preview revision,
      `SF-DOM-0155`, headers, share-token `view` claim, link rewriting keeps the view; OpenAPI + `schema.d.ts`
- [x] Full `./gradlew build` (`test --rerun`), `ui` `npm run build` + `npx vitest run`


## Review

- Backend as planned, plus two small UI touches (root-kind labels "Released"/"Unpublished", chain text
  `… · released in r1902, en`) and regenerated `schema.d.ts` (`PlanEntryView.locale`, preview `view` params).
- Design beyond the task text (details in each task's implementation notes): a released `Snapshot` is a family of
  per-language views with "unreleased" absent markers (tombstone semantics for free); incremental planning walks once
  per language, which replaces M24's `LocaleValueDiff` narrowing; preview reads through `ContentView`, the live
  counterpart of the snapshot view; share tokens carry `view` only for `published`.
- Fixes found on the way: `LocaleProjection` ignored `folderId` (a record moved between sets of one folder could never
  be released, M27.1); a section's `$CMS_REF` resolved outside its page's language (M24); a revision preview showed
  the current navigation (task goal); the planner loaded every released version on each plan (benchmark).
- Tests: `ReleaseFixtures` releases fixtures before builds and runs the golden check (released view == draft view,
  byte for byte, whenever they hold the same versions) on every generation test; new
  `ReleasedGenerationIntegrationTest` (7), `ReleaseIncrementalPlanIntegrationTest` (6), `PreviewViewIntegrationTest` (5).
- `./gradlew build test --rerun`: 1265 tests, 0 failures (5 skipped benchmarks); planning classes re-run after the last
  `RebuildExpansion` change; `ui` `npm run build` and `npx vitest run` (79 files, 536 tests) green.
- Benchmark, 5,000 pages × 2 locales, machine under load (same load for both): full build 11.4 s (master 15.6 s),
  snapshot 158 ms (205), one-page dry run 594 ms (868), all-changed plan 2.0 s (310 ms — one walk per language plus two
  release-state loads).
- **Follow-up (M27.1 / M27.6):** releasing 10,000 items in one call took ~430–490 s (later calls 2–4 s): the first
  "release all" of a large project is far too slow. Not measured apart from the golden check in the same call, so
  profile before fixing — saved as task `M27.1.4` (`01-release-model/004-release-performance-large-selections.md`); suspects are per-item queries in `ReleaseServiceImpl.resolve`/completeness inside one large
  transaction.

---

# M27 feature 1 — Release model (implementation, branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/01-release-model/`. Backend only; order 1.1 → 1.2 → 1.3.

- [x] M27.1.1 — `asset_release` (+ `released_uid`: a uid change writes no version), `AssetRelease`/repository,
      `ReleasableTypes`, `ReleaseLocales`, pure `LocaleProjection`, `ReleaseStatusService` (bulk, cached projections),
      `ReleaseState.at`, `ChangeType` RELEASE/UNPUBLISH/DISCARD, migration runner guarded by
      `project.release_state_initialized`, locale-set transitions (0→N copies `""` pointers to every locale,
      N→0 keeps the default locale's, removed locales close)
- [x] M27.1.2 — `ReleaseService` release/unpublish/discard/plan, dependency closure, completeness gate, delete
      semantics, `carryForward` for system migrations, restore untouched
- [x] M27.1.3 — `ReleaseController`, `ChangesController` (candidate query + diff), `release` block on DTOs, search
      facet, problems, OpenAPI + `schema.d.ts`
- [x] Full `./gradlew build` (`test --rerun`)

## Review

- Backend only, as planned. Design points beyond the task text (all in the task files' implementation notes):
  `released_uid` on the pointer (uid changes write no version); migration by startup runner + project flag;
  first/last locale transitions carry pointers; `ReleaseCarryForward` as its own component (bean cycle);
  restore/uid change/moves join an open batch so a discard is one revision; store roots not releasable.
- Follow-up for M27.3: `findChangeCandidates` counts one key for every media asset — localized media needs its
  locale count there.
- `./gradlew build test --rerun`: 1246 tests, 0 failures (4 skipped); re-run of the two late-edited test classes
  green; `ui` `npm run build` and `npx vitest run` (79 files, 536 tests) green after regenerating `schema.d.ts`.
- Benchmark 5,000 pages × 2 locales: migration 915 ms, project status 508 ms, Changes list 114 ms.

---

# M26 feature 5 — Docs and journey (implementation, branch `m26-user-management`)

Spec: `tasks/26-m26-user-management/05-docs-e2e/`.

- [x] M26.5.1 — spec §8.1–8.4, §9.2, §9.4, §20.2, §23, §24, §26 against the implemented behaviour; `infra/README.md`
      (`sf.security.password.*`, seeded admin, first steps in prod); `docs/administration.md`; deviations noted
- [x] M26.5.2 — `ui/e2e/m26-journeys.spec.ts` (two contexts, self-seeding), green twice on a clean dev stack;
      defects fixed with tests
- [x] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run`

## Review

- Docs: spec §8–§9, §20.2, §23, §24.5, §26.3, Appendix B; `docs/api.md`, `infra/README.md`, new
  `docs/administration.md`, `docs/user-guide.md`. Deviations between plan and code recorded in `M26.5.1`'s notes
  (epoch claim vs `iat`, own password change ends sessions, `LOCKED` keeps the session, `SF-API-0423` missing, no
  project-audit UI, no audit purge).
- Journey `ui/e2e/m26-journeys.spec.ts` green twice on a clean dev stack; defect found and fixed: the audit action
  filter hid the chosen actions (now chips, spec added).
- `./gradlew build test --rerun` 1185 tests green; `npm run build` green; `npx vitest run` 79 files, 536 tests green.

---

# M26 feature 4 — UI (implementation, branch `m26-user-management`)

Spec: `tasks/26-m26-user-management/04-ui/`. Frontend only; order 4.1 → 4.3 → 4.2 → 4.4.

- [x] M26.4.1 — `sf-user-menu` (dashboard header + nav rail), sign out, `/account` (profile, password with live
      policy checks, my projects, sign out everywhere), `/account/set-password` + `passwordChangeGuard` + `428`
      interceptor with return URL; self password change re-signs in with the new password (server revokes sessions)
- [x] M26.4.3 — Members tab (`settings/members`): read-only below `PROJECT_ADMIN`, lookup typeahead, role select,
      remove with self-removal warning
- [x] M26.4.2 — lazy `features/admin` (`/admin`, instance-admin guard): users list (server paging, debounced search,
      filters), create dialog (generate/set password, memberships, one-time password panel), detail (profile, actions
      with guard-rail reasons, delete by typing the username, memberships)
- [x] M26.4.4 — admin projects (archive/unarchive) and audit (filters in the URL); archived mode: `AuthStore.roleFor`
      is the effective role (instance admin → `PROJECT_ADMIN`, archived → `VIEWER`), `ProjectAccessStore.readOnly`
      (time travel or archived) replaces the `readOnly = timeTravel.isTimeTravel` aliases, banner + Unarchive
- [x] `npm run build`, `npx vitest run`; manual check in the running app (every task's manual list)

## Review

- UI: 79 spec files, 535 tests green (`npx vitest run`); `npm run build` green, `/admin` a lazy chunk (85 kB raw).
- Manual check: scripted Playwright walk against a dev backend on a scratch DB — every step of the four task files'
  manual lists, three green runs in a row; screenshots reviewed (fixed: create-dialog project row overflow, projects
  table action cell, "Viewing a past revision" notices in archived projects, raw role names on My account).
- Found and fixed: a revoked access token sent to `/auth/refresh` made the refresh fail (users signed out on every
  membership change since M26.1) — client no longer sends it, server ignores it (test added).
- Backend touch-ups for the forms: `field` on `409` duplicate username/email and on a wrong current password.

---

# M26 feature 3 — Admin API (implementation, branch `m26-user-management`)

Spec: `tasks/26-m26-user-management/03-admin-api/001-admin-projects-and-audit-api.md`. Backend only.

- [x] Domain: `AuditService.search(AuditFilter, page)` (JPA `Specification`, newest first by `created_at, id`),
      `AuditService.actions()`; `ProjectService.overview(q, includeArchived)` with member counts and head revisions
- [x] Changelog: indexes `audit_log(action, created_at)` and `(actor_user_id, created_at)` (`created_at` exists)
- [x] `GET /admin/projects`, `GET /admin/audit`, `GET /admin/audit/actions` (instance admin only)
- [x] API tests: each filter, combined, `_instance`, stable paging, `403`, member count / last change
- [x] Docs (`docs/api.md`), OpenAPI + `schema.d.ts`, `./gradlew build` (`test --rerun`), UI build + vitest

## Review

- Backend: 1184 tests green (`./gradlew build test --rerun`); new `AdminProjectsAndAuditApiTest` (7): every audit
  filter alone and combined, `_instance`, stable paging with equal timestamps, bad input, `403`/`401`, member counts
  and last change before and after membership revisions, text and archived filters.
- UI: `schema.d.ts` regenerated (three admin endpoints); `npm run build`, `npx vitest run` (63 files, 460 tests) green.

---

# M26 feature 2 — Archived projects (implementation, branch `m26-user-management`)

Spec: `tasks/26-m26-user-management/02-archived-projects/001-archived-projects-read-only.md`. Backend only.

- [x] Error code for "Project is archived": `SF-DOM-0141` (user decision; `SF-DOM-0130` is taken)
- [x] `ProjectWriteGuard` (sf-domain): one place that throws `409` for an archived project
- [x] Central guard in `RevisionServiceImpl.allocate` (covers `allocateOrJoin`/`beginBatch`)
- [x] `archive`: allocate first, then flip; new `unarchive`: flip first, then allocate; both audit
      (`PROJECT_ARCHIVED`/`PROJECT_UNARCHIVED`) and bump every member's epoch; `POST /projects/{key}/unarchive`
- [x] Hidden: `JwtServiceImpl` omits archived projects from `projects`; `GET /projects` filters for non-admins
- [x] Explicit guards on writes without a revision: generation start/promote/retry, share links (issue → 409,
      render → 404), search reindex, plus whatever the walk finds
- [x] User delete removes memberships of archived projects on purpose (guard bypass), with a test
- [x] Startup runners don't fail on an archived project
- [x] Endpoint walk test (`RequestMappingHandlerMapping`, allowlist with reasons)
- [x] Integration tests per acceptance criterion (still-valid token → 404, admin reads + writes 409,
      share link 404, generation 409, unarchive restores role + search)
- [x] Spec Appendix B row, OpenAPI + `schema.d.ts`, `./gradlew spotlessApply build` (`test --rerun`), `npm run build`
- [x] Early `ArchivedProjectInterceptor` + `@AllowedOnArchivedProject` (needed for a meaningful walk: validation
      otherwise answers `400` before the revision guard is reached)

## Review

- Backend: 1177 tests green (`./gradlew build test --rerun`); new `ArchivedProjectIntegrationTest` (7) and
  `ArchivedProjectEndpointWalkTest` (60+ handlers), `RevisionServiceImplTest` +2.
- Walk negative control (interceptor off) failed as expected and exposed an unguarded write: URL-registry
  reset/override and generation targets allocate no revision — now guarded in the domain/controller.
- UI: `schema.d.ts` regenerated (`unarchive`); `npm run build` and `npx vitest run` (63 files, 460 tests) green.
- Not changed: search stays unavailable for an archived project (index closed, pre-existing M23 behaviour).

---

# M26 feature 1 — Accounts (implementation, branch `m26-user-management`)

Spec: `tasks/26-m26-user-management/01-accounts/`. Backend lane, sequential (shared `UserService`,
`AuthService`, Gradle build). Implemented and committed as one change (the three tasks share `UserService`).

- [x] M26.1.1 — account model, password policy, forced change (`428`), immediate revocation, admin seeding
  - [x] changelog `019-user-management.xml` (`must_change_password`), `UserStatus.DELETED`
  - [x] `PasswordPolicy` + `sf.security.password.*` (+ unit tests)
  - [x] `PasswordChangeRequiredFilter` after bearer auth, exact allowlist; `/auth/me` gains `mustChangePassword`
  - [x] epoch bump in `setMemberRole`/`removeMember`; refresh rejects `DISABLED`/`DELETED` and drops the family
  - [x] `DELETED` treated like `DISABLED` in login and converter
  - [x] `DevAdminInitializer`: only into an empty table, `mustChangePassword` outside dev/demo/test
  - [x] audit `USER_PASSWORD_CHANGED`; integration tests per acceptance criterion
- [x] M26.1.2 — `/admin/users/**`, member lookup, private member emails
- [x] M26.1.3 — self-service `/auth/me` PATCH, password policy on change, `sessions/revoke`, `password-policy`
- [x] `./gradlew spotlessApply build` (`test --rerun`), OpenAPI + `schema.d.ts`, `npm run build`

## Review

- Backend: M26.1.1–1.3 together. New tests: `PasswordPolicyTest`, `UserAdministrationServiceTest`,
  `DevAdminInitializerTest`, converter cases, `AccountSessionRulesIntegrationTest`, `AdminUserApiTest`,
  `SelfServiceAccountApiTest`, `ConfiguredPasswordPolicyIntegrationTest`. Full `./gradlew build` green.
- UI: regenerated `schema.d.ts`; `npm run build` and `npx vitest run` (63 files, 460 tests) green. No UI code yet
  (M26.4): with a forced password change pending, today's UI would just see `428`s.
- Found on the way: a non-admin hitting any `hasAuthority` endpoint got `500` (fixed: `AccessDeniedException` → `403`).
  For M26.2.1 (noted in its task file): `SF-DOM-0130` is already taken, and the anonymizing delete must be able to
  remove memberships of archived projects once the central write guard exists.

---

# M25 — Record sets (implementation, branch `m25-record-sets`)

Spec: `tasks/25-m25-record-sets/`. One subagent per task; backend lane sequential (shared Gradle build and
service classes), UI lane parallel once the API exists. Each task is reviewed, tested and committed before the
next one in its lane starts.

## Backend lane
- [x] M25.1.1 — `RECORD_SET` asset type, containment, `RecordSetService`
- [x] M25.1.2 — stored set query: validation, evaluation, rename rewrite, broken-query flags
- [x] M25.2.1 — per-channel record templates on `DATASET`
- [x] M25.3.1 — `RecordSetController`, record create by set, DTOs, `schema.d.ts`
- [x] M25.2.2 — `recordset:` values, loops, reference editor, golden files
- [x] M25.2.3 — incremental planning + build insight
- [x] M25.4.1 — export/import

## UI lane (after M25.3.1)
- [x] M25.5.1 — Content store record sets
- [x] M25.5.2 — dataset record template editor
- [x] M25.5.3 — reference picker, search, routing

## Follow-ups found in review
- [x] Set grid: `revision` param on `GET /record-sets/{uuid}/records` (time travel lists records as of that
      revision) and a per-row `selectedBySet` flag in "All records" mode — replaces the UI's extra
      `_uuid == … || …` request for dimming (backend after M25.2.2, then UI)
- [x] Insight UI: `EDGE_LABELS` in `features/generation/insight/insight.util.ts` for `RECORD_SET_MEMBERSHIP`,
      `RECORD_SET_QUERY`, `RECORD_TEMPLATE`
- [x] Record template live check: `POST /octl/validate` gains a dataset context (`datasetUuid` + draft CDL) so
      unknown fields show while typing, not only on save (backend, then `dataset-schema-editor`)

- [x] Import UI: gate Proceed on `blocksImport` (not any BLOCKING), `RECORD_OUTSIDE_RECORD_SET` reads "will not be
      imported", icon for `RECORD_SET_QUERY_INVALID`; regenerate `schema.d.ts` (`blocksImport` fields)

## Finish
- [x] M25.6.1 — docs + spec
- [x] M25.6.2 — Playwright journey
- [ ] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run` green; merge to master

---

# Project settings — merge tabs

Collapse the nine project-settings tabs to five:

- **General** = General + Channels + Languages + Media (in that order)
- **Generation** = Targets + Generation (in that order)

remaining tabs: General · Generation · Revisions · Navigation URLs · Import / Export.

## Approach

Composition, not code moves. Each existing tab component keeps its template, styles, state and API calls;
two thin container components (`ProjectSettingsGeneralViewComponent`, `ProjectSettingsGenerationViewComponent`)
stack them as sections and own the page scrolling. Only the section chrome changed — heading level and the
`height: 100%` / `overflow: auto` the children used to need as route roots.

## Steps

- [x] `project-settings-general-view.component.{ts,html,scss}` — General, Channels, Languages, Media
- [x] `project-settings-generation-view.component.{ts,html,scss}` — Targets, Generation
- [x] Children become plain blocks: drop `height: 100%` / `overflow: auto` from `:host` and from the
      top-level wrapper in `project-settings-{general,media,locales,targets}`, `channels`, `generation` SCSS
- [x] Demote section titles `h1` → `h2` in locales / targets / channels / generation (one heading level
      under the shell's sr-only `h1`)
- [x] `app.routes.ts`: `general` and `generation` point at the containers; `media`, `locales`, `channels`
      redirect to `general` and `targets` to `generation`, so old deep links (and the Playwright journeys)
      still land on the content
- [x] `project-settings-shell.component.html` + class doc: remove the Channels, Languages, Media, Targets tabs

## Review

- `npx ng build` green; only pre-existing warnings (NG8102 in globals/templates, SCSS budget).
- `npx vitest run`: 20 spec files fail with `resolveComponentResources` — verified identical on a clean
  `git stash`ed tree, i.e. the known broken `templateUrl` spec runner, not this change.
- No e2e tests written or run (as requested). The `settings/channels`, `settings/locales` and
  `settings/generation` journeys in `e2e/m16`, `m22`, `m24` keep working through the redirects.
- Visual check in the running app skipped at the user's request (login form needs a password).

---

# UI unit suite — fix the 85 failing vitest tests

Started at `20 failed | 28 passed` files / `85 failed | 240 passed` tests; ended at **48 / 327 green**.

## Root cause (one config bug, ~70 of the 85)

`ui/vitest.config.ts` had no Angular plugin, so `templateUrl` / `styleUrl` were never inlined and every
component with external resources died in JIT with
`Component 'X' is not resolved … Did you run and wait for 'resolveComponentResources()'?`.

- [x] `vitest.config.ts` → `vitest.config.mts` with `@analogjs/vite-plugin-angular` (`jit: true`,
      `inlineStylesExtension: 'scss'`). `.mts` because the plugin is ESM-only and a CJS-transpiled
      `.ts` config cannot `require` it.
- [x] Pin `@analogjs/vite-plugin-angular` to `1.13.1` — the floating `^1.9.0` had resolved to `1.22.5`,
      which imports `defaultClientConditions` from Vite 6 while vitest 2.1.9 brings Vite 5.
- [x] `src/test-setup.ts`: import `@angular/core/testing` at module scope instead of inside `beforeAll`.
      It registers the global TestBed-reset `beforeEach`/`afterEach` as a load side effect; from a hook
      that is too late, and every raw-TestBed spec failed with "test module has already been instantiated".
- [x] `src/test-setup.ts`: jsdom shim for `URL.createObjectURL` / `revokeObjectURL` (missing in jsdom, and
      `vi.spyOn` throws on an absent property).

## Per-spec fixes (stale specs the broken runner had been hiding)

- [x] `global-set-detail`, `project-settings-import` — `provideHttpClient()` + `provideHttpClientTesting()`
      for the `EditingLocaleStore → LocalesStore → ApiClient` chain M24 introduced
- [x] `project-settings-export` — stub the `globalsFolderTree` / `contentFolderTree` signals the component reads
- [x] `templates` — `provideRouter([])` (component now injects `ActivatedRoute`); flush `[]` rather than
      `{ content: [] }` for the bare-array `/channels` and `/datasets` endpoints
- [x] `navigation` — fixture wrapped in the fixed "All Navigation" root the tree endpoint always returns
- [x] `nav-reference-detail` — expect the trailing `locale` argument M24 added to `updateReference`
- [x] `pagination-editor` — a second `detectChanges()`: constructor effects read the control only after the
      creation pass. Stale "can't run in this workspace" note dropped from the spec and the component doc.
- [x] Query/change-detection hygiene across `sf-create-asset-dialog`, `sf-rename-asset-dialog`, `pages-list`,
      `revision-diff`, `project-settings-url-registry`, `project-settings-import`: `getByRole('button', …)`
      instead of `getByText` (which resolves to the inner `<button>`, so `.closest('button')` and
      multiple-match errors both bite), and `fireEvent` / `findBy*` where an assertion needs the pass after
      the event.

## One implementation change (agreed with the user)

`sf-create-asset-dialog.component.html` — the submit button was `[disabled]="form.invalid || submitting()"`,
which made the `markAllAsTouched()` guard inside `submit()` unreachable: clicking Create with a blank name
did nothing and explained nothing. Now `[disabled]="submitting()"`, matching `sf-rename-asset-dialog`.

## Review

- `npx vitest run` → **48 files / 327 tests, all passing**.
- `npx ng build` → green, only the pre-existing NG8102 and SCSS-budget warnings.
- No e2e run.
