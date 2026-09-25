---
id: M27.1.3
status: done
depends: [M27.1.2]
epic: m27-release-and-scheduling
feature: release-model
area: backend
---

# M27.1.3 — Release and Changes API, `release` block on asset DTOs, search facet

## Context

`sf-api/.../api/` (`PageController`, `RecordController`, `RecordSetController`, `GlobalsController`,
`MediaController`, `FolderController`, `NavigationController`, `RevisionController` for the diff pattern),
`ProjectRoleExpr`, `ArchivedProjectInterceptor` + `@AllowedOnArchivedProject`, `ArchivedProjectEndpointWalkTest`,
`search/` (`SearchIndexer`, facets, `SearchController`), `M27.1.2`. Epic decisions 6, 9–12, 15, 17.

## Goals

- **Release endpoints** (`ReleaseController`, `/api/v1/projects/{key}/releases`):
  - `POST /plan` (`VIEWER`, `@AllowedOnArchivedProject`) — body `{items:[{assetUuid, locale?}]}` (`locale` omitted =
    every locale key of the asset) → resolved items, proposed dependencies (grouped by reason: reference, ancestor
    folder, descendant), findings, warnings.
  - `POST ` (`DEVELOPER`) — `{items, includeDependencies:[…], comment?}` → `{revision, released[], skipped[]}`.
  - `POST /unpublish`, `POST /discard` (`DEVELOPER`).
  - All go through one `ReleasePermissions` component (`canRelease`, `canUnpublish`, `canDiscard`, `canSchedule`),
    currently `DEVELOPER`, so `M28` changes one class.
- **Changes endpoints** (`ChangesController`):
  - `GET /api/v1/projects/{key}/changes` (`VIEWER`) — every (asset, locale) whose status is not `PUBLISHED` (i.e.
    `NEW`, `CHANGED`, `UNPUBLISHED`, `DELETION_PENDING`), paged (`page`, `size` ≤ 200), filters `type[]`, `status[]`,
    `locale[]`, `changedBy`, `folderUuid` (subtree), `q` (name/uid), sort `changedAt` desc default. Row: uuid, type, uid,
    displayName, folderPath, locale, status, changedBy/At (last draft version), releasedRevision, releasedBy/At,
    `scheduled` (filled by `M27.4.4`; `null` until then).
  - `GET /changes/{uuid}/diff?locale=` — structural diff between the released version's projection and the draft's
    projection for that locale, in the same shape as the revision diff (§7.6, field-path walker; rich text at block
    level). `NEW` diffs against empty; `DELETION_PENDING` reports "deleted".
  - `GET /changes/count` — counts per status (for a nav-rail badge).
- **DTOs.** Every releasable asset view (page, record, record set, global set, media, folder, page reference; list and
  detail) gains `release: {[locale]: {status, releasedRevision, releasedAt, releasedBy}}` and `scheduled` (`null` until
  `M27.4.4`). Tree/list endpoints use the bulk status call — no N+1 (assert query counts in one test).
- **Search facet.** The Lucene document gets `releaseStatus` (per locale key, multi-valued) updated on the release /
  unpublish / discard commit events (they are revisions, so `SearchIndexingListener` already fires); `GET /search`
  accepts `releaseStatus[]`.
- Problem details for `SF-DOM-0150`–`0154` registered in `ProblemFactory`; regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [x] MockMvc tests per endpoint: role (VIEWER reads, EDITOR 403 on mutations, DEVELOPER ok), archived (mutations 409,
      plan allowed — endpoint walk green with the new handlers), validation errors, happy paths.
- [x] Changes list: filters, paging, sort and counts correct on a fixture with every status and two locales.
- [x] Diff: localized field change shows only in that locale's diff; structural change in every locale.
- [x] Asset DTOs carry `release`; the pages tree call issues a bounded number of queries regardless of page count.
- [x] Search with `releaseStatus=CHANGED` finds an edited published page and not an unchanged one.
- [x] OpenAPI + `schema.d.ts` regenerated; `./gradlew build` green.

## Out of scope

- UI (`M27.6.x`), schedules (`M27.4.4`), editor permissions (`M28`).

## Notes / hazards

- The Changes list is the most expensive new read: statuses need projections of two versions per locale. Page through
  **candidate** assets first (open version's `validFrom` > open pointer's `validFrom`, or no pointer, or tombstone
  with pointer) using SQL, then compute projections only for the page. Document the candidate query.
- `diff` reuses the revision diff walker — don't write a second one.

## Implementation notes

- **Endpoints.** `ReleaseController` (`POST /releases/plan` VIEWER + `@AllowedOnArchivedProject`, `POST /releases`,
  `/releases/unpublish`, `/releases/discard` via `@releasePermissions.canRelease/canUnpublish/canDiscard`;
  `canSchedule` is there for M27.4.4). The release body takes `items` plus the kept `includeDependencies`, released in
  one revision. `ChangesController`: `GET /changes` (filters `type`, `status`, `locale` repeatable, `changedBy`,
  `folderUuid`, `q`; `sort=changedAt|displayName[,asc|desc]`; `size ≤ 200`), `GET /changes/count` (per status +
  `total`), `GET /changes/{uuid}/diff?locale=`.
- **Candidate query** (`AssetVersionRepository.findChangeCandidates`): open versions of releasable types whose count
  of open pointers *at exactly this version and uid* is below the key count (`CASE` 1 for media, else the project's
  locale count), plus tombstones with an open pointer. Only candidates are projected; filters, sort and paging run over
  the evaluated rows. **M27.3 must revisit the `CASE`**: a localized media asset has one key per locale.
- **`release` block** (`Map<locale, {status, releasedRevision, releasedAt, releasedBy}>`) and `scheduled` (always
  `null` until M27.4.4) on `PageView`, `AssetSummaryView`, `AssetDetailView`, `MediaView`, `MediaSummaryView`,
  `FolderView` (tree), `NavTreeView` (tree), `GlobalSet*View`, `RecordDetailView`, `RecordRowView`,
  `RecordSet*View`, `PageReferenceView`; `null` for assets without a release state and for past versions
  (`/assets/{uuid}/versions/{r}`). Lists and trees call `ReleaseStatusService.ofUuids` once per response
  (`ReleaseBlocks`); the test asserts one `ofUuids` call and no `ofAsset` call for a 12-page list.
- **Search facet.** Documents carry the distinct statuses over the asset's locales (`releaseStatus` string field,
  filter only); `SearchSchemaVersion` 1 → 2 so every index is rebuilt once (the initial-release revision has only a
  project summary entry). Release revisions list their assets in the summary, so the catch-up re-indexes them;
  `GET /search?releaseStatus=CHANGED` (repeatable/comma-separated).
- **Problems.** `SF-DOM-0150`–`0154` are built in `ReleaseProblems` (422 with `code`, plus `assets` for 0150/0152);
  the generic `SfException` handler serializes them, no `ProblemFactory` change was needed.
- **Tests:** `ReleaseApiTest` (8: roles, archived, validation codes, dependencies taken along, Changes list with every
  status in two locales, counts, diff per locale and rename, release block + bounded status calls, search facet) and the
  archived endpoint walk (allowlist gained `ReleaseController#plan`). OpenAPI and `schema.d.ts` regenerated; `ui`
  `npm run build` and `npx vitest run` (79 files, 536 tests) green.
