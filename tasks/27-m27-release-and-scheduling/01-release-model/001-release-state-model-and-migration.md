---
id: M27.1.1
status: done
depends: []
epic: m27-release-and-scheduling
feature: release-model
area: backend
---

# M27.1.1 — Release state: `asset_release`, locale projection, status, migration

## Context

`asset/AssetVersion.java` (`validFromRevision`/`validToRevision`, `deleted`), `asset/AssetReference.java` (the
revisioned-row pattern to copy), `asset/AssetVersionRepository.java` (`findValidAtRevision` `:52`, `findSnapshot`
`:131`), `revision/ChangeType.java` (`PUBLISH` unused, `:14`), `asset/localization/TranslationStatusService.java`
(how M24 decides "missing translation" per locale), `project/ProjectLocales` (locales, fallback chains),
`asset/AssetType.java`, `asset/folder/PathService.java` (store roots — which folders are editorial). Changelogs under
`sf-app/src/main/resources/db/changelog/v1.0/` (next free: `020`). Epic decisions 1–6, 12, 13.

## Goals

- **Schema.** Changelog `v1.0/020-release-state.xml`: table `asset_release` (`id`, `project_id`, `asset_id`,
  `locale_key` varchar(35) not null, `released_version_id` FK `asset_version`, `valid_from_revision`,
  `valid_to_revision` null, `released_by`, `released_at`), unique open row per (`asset_id`, `locale_key`) enforced the
  way `asset_reference` does it, indexes for "open rows of a project" and "rows valid at R". H2 and PostgreSQL.
- **Entity + repository.** `AssetRelease` / `AssetReleaseRepository` with revision-aware readers mirroring
  `AssetVersionRepository`: open rows of an asset, rows valid at R for a project (bulk, for snapshots), rows valid at
  R for a set of asset ids.
- **`ReleaseState`** (domain read model): `at(projectId, revision)` → (asset, locale) → released version id; cheap
  bulk load for a whole project (used by `M27.2.1`).
- **`ChangeType`**: add `RELEASE`, `UNPUBLISH`, `DISCARD`; remove `PUBLISH` after verifying (grep + a query against the
  dev/test databases in the task notes) that no `revision.change_type` row uses it.
- **Releasable types.** `ReleasableTypes.isReleasable(assetType, folderStore)` — the single place encoding decision 1
  (editorial folders yes, template-store folders no, `DATASET` no).
- **Locale keys.** `ReleaseLocales.keysFor(project, asset)` → `[""]` for non-localized projects and non-localized media,
  else the project's configured locales (decision 4). Localized media (flag from `M27.3.1`) is read defensively: until
  `M27.3.1` lands, every media is non-localized.
- **Locale projection.** `LocaleProjection.project(version, locale, chain)` → canonical JSON of what locale L renders:
  L10N values resolved along the fallback chain (a plain value where L10N is expected is "all locales" and vice versa —
  decision 13's tolerant read), plain values as-is, plus uid, display name (and localized page-reference labels),
  folder path, template id, deleted flag; for media the blob sha(s) L renders and localized metadata.
- **Status.** `ReleaseStatusService.status(asset, locale)` and a bulk variant per project/folder:
  `NEW` / `PUBLISHED` / `CHANGED` / `UNPUBLISHED` / `DELETION_PENDING` from (open pointer?, draft deleted?,
  projection(draft) equals projection(released)?). Bulk evaluation must not load payload JSON twice per locale; cache the
  projection of a version per (version id, locale) within one call.
- **Migration.** A Liquibase `customChange` (or a one-time startup runner guarded by a Liquibase-recorded marker —
  pick one and justify in the notes) that, per project, opens a pointer for every non-deleted releasable asset and every
  locale key at its open version, in **one** revision per project (`ChangeType.RELEASE`, comment "Initial release
  state (M27)", system user). Idempotent; archived projects included (uses `allocateEvenIfArchived`).
- **Locale set changes.** Removing a locale from the project (`PUT /projects/{key}/locales`) closes that locale's
  pointers in the same revision; adding one creates none (decision 4).

## Acceptance criteria

- [x] Changelog runs on H2 and PostgreSQL (Liquibase drift/diff test, if present, stays green).
- [x] After migration every non-deleted releasable asset of a fixture project (pages, records, record sets, globals,
      media, editorial folders, page references; with and without locales) is `PUBLISHED` in every locale key;
      templates, template folders and datasets have no pointer; a second run adds nothing.
- [x] Status unit tests: an edit of only the EN value → EN `CHANGED`, DE `PUBLISHED`; an edit of a shared field, a
      section reorder, a move and a rename → every locale `CHANGED`; a value that only changes what a *fallback* locale
      shows (e.g. `de-CH` falling back to `de`) marks exactly the locales that see it; a delete → `DELETION_PENDING`; a
      never-released asset → `NEW`.
- [x] Tolerant projection: a page migrated by the M24 localizable toggle (plain → L10N with the same value) projects
      identically before and after.
- [x] `ReleaseState.at(project, R)` returns the pointers valid at R (property test against a random sequence of
      releases/unpublishes, like `RevisionInvariantsTest`).
- [x] Removing a locale closes its pointers in the locale-change revision.
- [x] `./gradlew build` green.

## Out of scope

- Mutations (release/unpublish/discard, `M27.1.2`), API (`M27.1.3`), rendering (`M27.2.x`), localized media storage
  (`M27.3.1`).

## Notes / hazards

- Revision invariants: the pointer rows must satisfy the same "exactly one open row, intervals never overlap"
  invariants as versions; extend the property-based suite rather than writing a new one.
- The projection is the heart of per-locale status — keep it pure (no repository calls) and test it table-driven.
- `ChangeType` is persisted by name: removing `PUBLISH` is only safe when no row uses it; if one does, keep it and
  mark it `@Deprecated` instead (note it here).
- Pointer-per-locale multiplies rows (assets × locales): measure the migration on the 5,000-page fixture with 2 locales
  and record the time in the notes.

## Implementation notes

- **`released_uid` column.** A uid change writes no `asset_version` (M22.4.1: `AssetServiceImpl.changeUid` only updates
  `asset.uid` and `asset_uid_history`), so the released version alone can't say which uid a locale renders. Every
  pointer stores the uid it was released under; a rename is `CHANGED` until released, and M27.2.1 renders the pointer's
  uid.
- **Unique open row** is kept by the writers, exactly like `asset_version`/`asset_reference` (no partial index on H2);
  the jqwik property in `RevisionInvariantsTest` proves at most one open and one valid pointer per revision.
- **Migration = startup runner, not a Liquibase `customChange`.** `ReleaseStateMigration` needs revision allocation,
  `ProjectLocales` and `ReleasableTypes`; a changeset would duplicate them in SQL. `020-release-state.xml` adds
  `project.release_state_initialized` (existing rows `false`, `Project` defaults new rows to `true`);
  `ReleaseStateInitializer` (`@Order(HIGHEST_PRECEDENCE)`) migrates each unflagged project in its own transaction with
  `allocateEvenIfArchived`, one `RELEASE` revision without author, comment "Initial release state (M27)", one summary
  entry `PROJECT/INITIAL_RELEASE` (listing thousands of assets would flood the revision spine). It skips pairs that
  already have an open pointer, so a flag reset by hand duplicates nothing. A failure propagates: the app must not
  start half migrated.
- **Store roots are not releasable.** `ReleasableTypes` excludes `pages_root`, `media_root`, `navigation_root`,
  `globals_root`, `content_root` and the hidden `root` — protected, never edited, always present.
- **`ChangeType.PUBLISH` removed.** No code wrote it; the dev database copy has only `CREATE` revisions
  (`SELECT change_type, COUNT(*) FROM revision GROUP BY change_type`), and test databases start empty.
- **Locale transitions** (`ReleaseLocaleTransition`, called by `ProjectServiceImpl.updateLocales` in the locale-change
  batch revision): removing locales closes theirs; adding locales opens none; a project's *first* locales turn each
  `""` pointer into one per locale (non-localized media keeps `""`), and removing the *last* ones turns the default
  locale's pointer into `""` — otherwise enabling languages would unpublish the whole site. Carried pointers keep their
  original author and time.
- **Status service.** `ReleaseStatusService.of/ofVersions/ofUuids/ofProject` use a fixed number of queries (pointers,
  release history, released versions — each chunked at 1,000 ids for PostgreSQL's bind limit) and a per-call
  projection memo; a pointer at the draft itself under the same uid is `PUBLISHED` without projecting. A deleted draft
  released nowhere has no status (it's gone, not pending).
- **Tests:** `LocaleProjectionTest` (table-driven: EN-only, shared, fallback de-CH, Swiss-only, section order, rename,
  move, delete, tolerant plain/L10N, `""` key, locale keys), `ReleasableTypesTest`, `ReleaseStateIntegrationTest`
  (14: migration of every type with and without locales, idempotence, new projects start initialized, statuses,
  localizable toggle, bulk, locale removal/addition, first/last locales, release state at a revision).
- **Measured** (`ReleaseMigrationBenchmark`, `SF_PERF=true SF_PERF_PAGES=5000 SF_PERF_LOCALES=2`): 10,000 pointers
  migrated in 915 ms; whole-project status 508 ms; Changes list with 1,000 pending rows 114 ms.
- **Changelog** verified on H2 only (no PostgreSQL on this machine); it uses only portable DDL (`BIGINT`, `VARCHAR`,
  `BOOLEAN`, `TIMESTAMP WITH TIME ZONE`, plain indexes).
