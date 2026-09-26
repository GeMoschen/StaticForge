# M27 — Release state (draft/published) for editorial content + scheduler

**Spec:** Reverses the v1 non-goal in §2.2 ("No editorial workflow engine") partially: a draft/published
(**release**) state, without approval gates. Touches §5 (domain model: a new release pointer next to
`asset_version`), §7 (revisions: new `ChangeType`s, time travel of release state), §10 (page lifecycle), §11 (media:
localized files), §14/§16 (rendering of unreleased references), §17 (navigation), §18 (generation: what is rendered,
incremental planning, the "Scheduled | full, cron per project" trigger of §18.1), §19 (preview draft/published),
§20 (REST), §23/§24 (Changes view, Schedules view, release bar), §26.5 (export protocol 8), Appendix B. Resolves the
§27 post-v1 candidate "scheduled publishing". Not part of the original §27 roadmap — inserted the same way
`M8`–`M26` were.

## Goal

Today every save is live: a generation run renders the latest saved version of every asset (at the pinned
revision), so a half-finished edit goes online with the next build started by anyone, for any reason. Nothing can
happen at a planned time either — there is no scheduler at all.

This milestone delivers:

- **Release state for all editorial content** — pages, records, record sets, global sets, media, editorial folders
  and navigation page references. Each **(asset, locale)** has a *released version*; a build renders only released
  versions. Saving creates a *draft*; **Release** makes the draft the released version (one revision), **Unpublish**
  takes it offline without deleting it, **Discard changes** writes the released version back.
- **Per-locale release**: DE can stay on the old text while EN goes live, including structural changes (move,
  rename, sections).
- **Localized media**: a media asset may carry one file per locale (flag, default off), released per locale.
- **Changes view**: every unreleased change of the project in one list, with diff, dependency-aware multi-release,
  discard and scheduling.
- **Preview** shows the draft by default and the released state on demand; share links choose.
- **Scheduler**: an extensible, multi-node-safe engine with four action types — scheduled release, scheduled
  unpublish (both with an optional "then generate"), one-off generation and recurring (cron) generation — with pin,
  missed-run and time-zone policies.
- **Export/import** protocol 8 carries release state.

## Findings from planning (2026-09-25)

1. **One decision point for "what is rendered".** `SnapshotService.snapshot(projectId, revision)`
   (`sf-generate/.../generate/snapshot/SnapshotService.java:34`) loads `AssetVersionRepository.findSnapshot`
   (`AssetVersionRepository.java:131`, the version valid at the pinned revision, tombstones included) into an
   immutable `Snapshot`; every generation consumer (`SnapshotNavigationLookup`, `SnapshotAssetValueResolver`,
   `SnapshotTemplateHierarchy`, `SnapshotPagination`, `OutputPathResolver.forSnapshot`) reads only the snapshot.
   Exceptions: `UrlRegistryService.resolve` is read live (`GenerationRenderer.java:751-754`), incremental "before"
   lookups read the database at the baseline, channels and locales are read live.
2. **Incremental planning counts version changes.** `RebuildExpansion.changesSince` (`:144`) seeds the walk with
   versions whose `validFrom` lies in `(baseline, R]` (`AssetVersionRepository.findChangesBetween`, `:360`), then walks
   reverse `asset_reference` edges. `GenerationService.baselineFor` (`:380`) takes the baseline from the target's
   build manifest (`consistentRevision`). With a release state, *saving* no longer changes output — *releasing* does.
3. **Tombstones are the closest analogue of "not published".** A deleted page is filtered by `Snapshot.pages()`,
   `SnapshotNavigationLookup`, the site outputs (sitemap, `search-index.json`), dataset/record-set loops
   (`SnapshotAssetValueResolver`), and a `$CMS_REF` to it renders empty with `SF-GEN-0220`
   (`GenerationRenderer.isDeleted`). An unreleased asset must be filtered at exactly the same places.
4. **Preview reads live state through three separate paths.** `PageRenderService.doRender` (`requireCurrent` or
   `findAt`), `LiveAssetValueResolver` (current or `…At` queries) and `LiveNavigationLookup` (always current, even with
   a revision — `validTo IS NULL AND !deleted`). `PreviewTokenService` issues stateless HS256 share tokens (7-day TTL)
   binding page/media, revision, channel, project and locale.
5. **`ChangeType.PUBLISH` exists but is never used** (`revision/ChangeType.java:14`, 0 references in code).
6. **Folder paths are denormalized.** `PathService` / `FolderService` write the folder path onto every descendant
   version; a folder rename or move therefore writes a new version of every descendant — each of them becomes a
   (structural) draft under this epic.
7. **System migrations write content versions.** M24's localizable toggle (`LocalizationMigrationService`) and CDL
   content migration (§12.3) rewrite page/section/record payloads in one compound revision. Under a release model those
   writes would turn every affected, otherwise unchanged asset into a draft.
8. **No scheduling infrastructure exists.** No `@EnableScheduling`, `@Scheduled`, `TaskScheduler`, ShedLock or
   `FOR UPDATE SKIP LOCKED` anywhere; the only periodic task is `SearchIndexServiceImpl`'s private
   `ScheduledExecutorService`. Virtual threads are on (`spring.threads.virtual.enabled`).
9. **Generation start is single-node and in-memory.** `GenerationService.start` serializes on a JVM `startLock`,
   refuses a second active run with `409 SF-GEN-0500` (`findActive`), keeps idempotency keys in memory; a run left
   `QUEUED`/`RUNNING` by a crash blocks the project until cancelled (recovery is `M29`). `comment` is not persisted.
10. **Media output is one file per asset**: `MediaPaths.mediaPath` → `assets/media/{uid}.{ext}`, variants
    `assets/media/{uid}-{V}.{ext}`. `altText`/`caption` are already localizable (M24), the binary is not.
11. **Export protocol is 7** (`ProjectExportImportService.PROTOCOL_VERSION`, `:31`).

## Decisions (binding for all tasks — revisit only with the user)

*Release model*

1. **Released types.** Release state applies to the editorial asset types `PAGE`, `RECORD`, `RECORD_SET`,
   `GLOBAL_SET`, `MEDIA`, `PAGE_REFERENCE` and `FOLDER` in the editorial stores (pages, media, content, navigation).
   Section/page templates, template-store folders, `DATASET` (a schema), channels, targets, locales and project
   settings stay **live**: a build renders their version at the build revision, as today.
2. **Always on, migrated.** No switch. Changelog `v1.0/020-release-state.xml` plus a one-time migration mark every
   non-deleted editorial asset released, for every locale key it has, at its current version. After the migration a
   build of an unchanged project is byte-identical to the build before it.
3. **Model.** Table `asset_release` (`project_id`, `asset_id`, `locale_key`, `released_version_id` → `asset_version`,
   `valid_from_revision`, `valid_to_revision`, `released_by`, `released_at`), revisioned exactly like `asset_reference`:
   a release/unpublish closes the open row and opens a new one in the same revision. *No open row* for
   (asset, locale) = not released for that locale. Build and time travel at revision R use the release state at R
   (reproducible republishing, §18.1).
4. **Locale keys.** Non-localized projects and non-localized media use the single key `""` ("all locales"). In a
   project with locales, every released asset except non-localized media has one pointer per configured locale.
   Adding a locale to the project creates no pointers (the new locale is `NEW` everywhere); removing a locale closes its
   pointers in the same revision as the locale change.
5. **Per-locale whole-version rendering.** Locale L of an asset renders the **whole** released version for L (shared,
   non-localizable fields included). DE may therefore still render the old structure/path/sections while EN has the
   new ones.
6. **Status** (`ReleaseStatus`, per asset and locale): `NEW` (never released), `PUBLISHED` (released and the draft
   looks the same in that locale), `CHANGED`, `UNPUBLISHED` (was released, now not; the draft exists),
   `DELETION_PENDING` (draft deleted, released version still live). "Looks the same in L" compares the *locale
   projection* of draft and released version: L10N values resolved for L along the fallback chain, plain values as-is,
   plus uid, display name (and localized labels), folder, template, deleted flag, and for media the file(s) that L
   renders. Editing only the EN value leaves DE `PUBLISHED`; a structural edit changes every locale. A scheduled
   action touching an asset is a separate indicator (`scheduled`), not a status.
7. **Release = state change only.** `Release` (and `Unpublish`, `Discard`) never starts a build; the site changes with
   the next generation run (manual, or a schedule's "then generate", decision 21).
8. **Structural changes are drafts.** Delete, move, rename/UID change, section add/remove/reorder are ordinary drafts:
   the released version keeps rendering at its old path until released. Releasing a deletion (`DELETION_PENDING`)
   unpublishes the asset in that locale; once no locale is released the tombstone is simply the draft. Deleting a
   **never-released** asset (`NEW` in every locale) is immediate, as today. A folder rename makes every descendant
   `CHANGED` (finding 6); the release dialog offers "include the N descendants".
9. **Dependencies.** Releasing computes the *unreleased dependencies* of the selection: transitively over
   `asset_reference` edges valid at head that point at editorial assets in `NEW`/`CHANGED`/`UNPUBLISHED` for the same
   locale, plus ancestor editorial folders that are not released. They are proposed **included by default**; the user
   can untick any. Whatever stays unreleased renders like a missing asset: empty output plus the new build warning
   **`SF-GEN-0221` "Reference to an unreleased asset"** (same places as `SF-GEN-0220`).
10. **Completeness blocks release.** An asset with `ERROR` completeness findings (§10.5) in the released locale can't be
    released: `422 SF-DOM-0150` "Content incomplete" with the findings per asset. Generation's hold-back
    (`SF-GEN-0120`) stays as the safety net.
11. **Discard changes** writes the released version of a locale back as a new version (new revision, append-only,
    `ChangeType.DISCARD`). In a localized asset, discarding one locale restores that locale's L10N values and — only
    when every other locale is `PUBLISHED` against the same released version — the shared fields; otherwise the
    shared fields stay and the response says so (`sharedFieldsKept: true`). Not offered for `NEW` (delete instead).
12. **Revisions and audit.** One release action = one revision (`ChangeType.RELEASE`, `UNPUBLISH`, `DISCARD`; the unused
    `PUBLISH` constant is removed after verifying no row uses it). The revision summary lists every
    (asset, locale, released version). No separate audit entries — revisions are the content audit trail (§26.3).
13. **System migrations carry releases forward.** When a system migration (M24 localizable toggle, CDL content
    migration, M25-style data migrations) rewrites an asset whose locale is `PUBLISHED`, the release pointer moves to
    the migrated version in the same revision. For a `CHANGED` locale the released version keeps its old shape, and
    every reader of released payloads tolerates both shapes (a plain value where L10N is expected reads as "all
    locales"; an L10N value where plain is expected reads the render locale).
14. **Project restore restores drafts only** (`ProjectRestoreService.restoreTo`); release state is unchanged. The
    Changes view shows what a restore made different from the released state.
15. **Permissions (M27 only).** Release, unpublish, discard and every schedule operation require `DEVELOPER`;
    reading status, the Changes view, schedules and previews requires `VIEWER`. `M28` opens release/scheduling/builds
    to editors by project policy — keep every check on a single named method per operation so M28 can swap it.

*Rendering and preview*

16. **Generation always renders the released view**; preview renders the **draft view** by default (the page's
    draft and the drafts of everything it references), and the released view with `?view=published`. Share links bind
    the view (`draft` | `published`) at creation.
17. **Unreleased = absent** everywhere a tombstone is absent today: pages, outputs, navigation, sitemap, robots,
    redirects, `search-index.json`, dataset/record-set loops, pagination sources, `$CMS_REF`, global values, media
    copies. The CMS search (Lucene) keeps indexing drafts and gains a `releaseStatus` facet.

*Localized media*

18. **Flag `localized`** on a media asset (payload, default `false`). A localized media asset holds one file per
    locale; a locale without its own file falls back along the locale chain. It is released per locale and written
    once per locale **that has its own file**, at the locale prefix of that locale's pages (`{localePrefix}assets/media/
    {uid}.{ext}`, honouring "default locale without prefix"); references and `$CMS_REF(media:…)` pick the render
    locale's file (after fallback). Non-localized media: one file, one pointer (`""`), released for all locales.
19. **Toggle both ways, one revision.** Localizing: the existing file becomes the default locale's file. Un-localizing:
    keep the default locale's file; the other locale files are discarded after a confirmation (`409 SF-MEDIA-0505`
    with the list unless `confirmDiscard=true`). Release pointers are rewritten to match (per-locale ↔ `""`), each
    carrying the status it had for the default locale.

*Scheduler*

20. **Engine.** Tables `scheduled_action` and `scheduled_action_execution` (changelog `022-scheduler.xml`);
    `SchedulerEngine` polls every `sf.scheduler.poll-interval` (default 15 s) and claims due actions with a conditional
    `UPDATE … SET lease_owner, lease_until WHERE id = ? AND (lease_until IS NULL OR lease_until < now)` — portable
    across H2 and PostgreSQL and safe with several nodes. Handlers implement the SPI `ScheduledActionHandler`
    (`type()`, `validate(params, actor)`, `requirements(params)`, `execute(ctx)`); new types are a new bean.
    `requirements(params)` returns `ActionRequirements` (a minimum role plus a set of named permissions, empty in M27);
    the API (create/edit/take over) and the engine (execution re-check) evaluate the same object. M28 fills the
    permission set from its publish policy.
21. **Action types (M27):** `RELEASE` (a set of asset×locale), `UNPUBLISH` (a set), `GENERATION` (one-off: mode,
    channels, target, scope) and `RECURRING_GENERATION` (cron). `RELEASE`/`UNPUBLISH` have an optional **then
    generate** (incremental; target and channels chosen) started right after the release revision.
22. **Pin policy** per `RELEASE`: `PINNED` (default — the versions current when the schedule was created or last
    re-pinned go live) or `LATEST` (whatever is saved at execution). A pinned schedule whose assets have newer drafts
    shows "draft changed since scheduled" and can be **re-pinned**. A pinned version that has become incomplete can't
    exist (versions are immutable); a `LATEST` asset with `ERROR` findings fails that asset (partial execution,
    reported per asset).
23. **Missed policy** per action: `RUN_LATE` (default) or `SKIP_IF_LATER_THAN` (`max_lateness`). A recurring schedule
    that missed several slots runs **at most once** for them, then continues with the next future slot.
24. **Time zones.** The UI takes times in the viewer's browser zone. One-off actions are stored as UTC instants;
    recurring ones store the cron expression **and** the creator's IANA zone id and are evaluated in that zone
    (DST-correct: a skipped local time runs at the next valid instant, a repeated one runs once). The UI shows times in
    the viewer's zone, plus the schedule's zone where it differs.
25. **Authority.** An action runs as its **owner** (initially the creator). Permissions are re-checked at execution;
    if the owner lost them (removed, role lowered, disabled, deleted, policy toggle off in M28) the execution fails with
    `SF-DOM-0163` "Owner no longer permitted". A permitted user can **take over** (becomes owner) and rerun.
26. **Archived projects** execute nothing; after unarchive the missed policy applies. Creating/editing schedules in an
    archived project is refused by the M26 guard.
27. **Busy generation.** A `GENERATION`/then-generate step that meets an active run (`SF-GEN-0500`) stays due and
    retries on each tick until the run ends, bounded by the missed policy (a `RUN_LATE` action waits indefinitely,
    showing "waiting for run #n").

*Export/import*

28. **Protocol 8** carries each asset's open release pointers (locale key + the version they point at, exported as
    "released payload" when it differs from the draft) and localized media files. The import analysis/dialog offers
    **keep release state from the archive** (default) or **import everything as draft**. Protocol ≤ 7 archives import
    as drafts (`NEW`). ~~Schedules are not exported.~~ *Amended 2026-09-26 (user request):* protocol 9 carries the
    open schedules — see [08-schedule-export](08-schedule-export/README.md).

## Exit criteria (epic is done when)

- [x] After the migration, a full build of every existing fixture project is byte-identical to the build before it.
- [x] Editing a published page changes nothing in the next build; releasing it (one revision) changes exactly that
      page's outputs (plus what depends on it) in an incremental build.
- [x] Per-locale release: releasing only EN of a page with DE and EN changes only the EN outputs; DE keeps its old
      text, path and sections.
- [x] Delete, move and rename of a published page are drafts until released; releasing a deletion removes the output;
      deleting a never-released page is immediate.
- [x] The release dialog proposes unreleased dependencies (references and ancestor folders), included by default;
      an unticked dependency renders empty with `SF-GEN-0221`.
- [x] Release is refused for incomplete content (`422 SF-DOM-0150`); discard restores the released version.
- [x] Preview shows the draft by default and the released state with the toggle; share links keep their view.
- [x] A media asset can be localized with one file per locale, released per locale and written at the locale prefix;
      un-localizing asks before discarding files.
- [x] The Changes view lists every unreleased asset×locale with diff; multi-select release, discard and schedule work.
- [x] Scheduled release (pinned and latest, with and without then-generate), scheduled unpublish, one-off and
      recurring generation execute on time in the creator's time zone; missed, busy, owner-lost and archived cases
      behave as decided; executions are listed with outcome.
- [x] Export/import protocol 8 round-trips release state; the import option "everything as draft" works; protocol 7
      archives import as drafts.
- [x] `./gradlew build` (`test --rerun`), `ui` `npm run build` and `npx vitest run` green; the Playwright journey
      green twice on a clean dev stack.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [release-model](01-release-model/README.md) | backend | `M26` |
| 2 | [released-rendering](02-released-rendering/README.md) | backend | 1 |
| 3 | [localized-media](03-localized-media/README.md) | backend | 1.1 (3.2 also 2.1) |
| 4 | [scheduler](04-scheduler/README.md) | backend | 1.2 (4.3 also `M22`) |
| 5 | [export-import](05-export-import/README.md) | fullstack | 1.1, 3.1 |
| 6 | [ui](06-ui/README.md) | frontend | 1–5 (per task) |
| 7 | [docs-e2e](07-docs-e2e/README.md) | qa | 1–6 |
| 8 | [schedule-export](08-schedule-export/README.md) | fullstack | 4, 5 (follow-up, 2026-09-26) |

Features 3 and 4 can run in parallel with feature 2 once `M27.1.2` is done (different packages).

## Dependencies

`M15` (compound revisions, `beginBatch`), `M16` (`asset_reference` materialization, revision-aware readers), `M19`/
`M25` (records, record sets, `SnapshotAssetValueResolver`), `M22` (`BuildPlanner`, `RebuildExpansion`, reason chains,
manifests, `consistentRevision`), `M23` (search index, facets), `M24` (locales, fallback chains, L10N values,
`LocalizationMigrationService`, `TranslationStatusService`), `M26` (archived guard `ProjectWriteGuard`,
`@AllowedOnArchivedProject`, endpoint walk test).

## Notes

- **API shape.** Release endpoints under `/api/v1/projects/{key}/releases` (`POST` release, `POST …/unpublish`,
  `POST …/discard`, `POST …/plan` = dependency closure dry run), `GET /projects/{key}/changes` (paged, filterable) and
  `GET /projects/{key}/changes/{uuid}/diff?locale=`; every asset DTO gains `release: {locale → {status, releasedRevision}}`
  and `scheduled`. Schedules under `/api/v1/projects/{key}/schedules`. Regenerate OpenAPI and
  `ui/src/app/core/api/generated/schema.d.ts` after each backend task that changes the API.
- **Endpoint walk.** Every new mutating endpoint joins M26's `ArchivedProjectEndpointWalkTest` (409 on archived
  projects) — `…/releases/plan` is read-only and carries `@AllowedOnArchivedProject`.
- **Error codes:** `SF-DOM-0150`–`0159` release, `SF-DOM-0160`–`0169` scheduler, `SF-MEDIA-0505`–`0509` localized
  media, `SF-GEN-0221` unreleased reference (warning). Assigned per task; Appendix B in `M27.7.1`.
- **Not in scope:** approval / four-eyes workflow; editor permissions for release, schedules and builds (`M28`);
  housekeeping jobs on the scheduler (`M29`); link/SEO checks and redirects (`M30`); email or push notifications;
  external schedulers (cron outside the app); per-channel release. (Exporting schedules was out of scope until the
  follow-up feature 8.)
- **Spec follow-up (in `M27.7.1`):** §2.2 (non-goal narrowed), §5 (release pointer), §7 (`ChangeType`s, time travel of
  release state), §10.4 (lifecycle: release, unpublish, discard; structural drafts), §11 (localized media, output
  paths), §16.4 (unreleased references), §17, §18.1 (scheduled trigger), §18.2 (SNAPSHOT released view, PLAN seeds),
  §19 (draft/published preview, share-link view), §20.2, §23/§24 (Changes, Schedules, release bar), §26.5
  (protocol 8), Appendix B.
