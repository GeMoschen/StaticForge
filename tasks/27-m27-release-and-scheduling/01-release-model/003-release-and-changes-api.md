---
id: M27.1.3
status: todo
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

- [ ] MockMvc tests per endpoint: role (VIEWER reads, EDITOR 403 on mutations, DEVELOPER ok), archived (mutations 409,
      plan allowed — endpoint walk green with the new handlers), validation errors, happy paths.
- [ ] Changes list: filters, paging, sort and counts correct on a fixture with every status and two locales.
- [ ] Diff: localized field change shows only in that locale's diff; structural change in every locale.
- [ ] Asset DTOs carry `release`; the pages tree call issues a bounded number of queries regardless of page count.
- [ ] Search with `releaseStatus=CHANGED` finds an edited published page and not an unchanged one.
- [ ] OpenAPI + `schema.d.ts` regenerated; `./gradlew build` green.

## Out of scope

- UI (`M27.6.x`), schedules (`M27.4.4`), editor permissions (`M28`).

## Notes / hazards

- The Changes list is the most expensive new read: statuses need projections of two versions per locale. Page through
  **candidate** assets first (open version's `validFrom` > open pointer's `validFrom`, or no pointer, or tombstone
  with pointer) using SQL, then compute projections only for the page. Document the candidate query.
- `diff` reuses the revision diff walker — don't write a second one.
