---
id: M16.3.3
status: todo
depends: [M16.3.1, M16.3.2]
epic: m16-render-reference-foundations
feature: reference-materialization
area: backend
---

# M16.3.3 — Revision-aware reference queries; readers migrated; generation stops inserting; cleanup

## Context

Readers of `asset_reference` today:
- `AssetServiceImpl.softDelete` (~l.232): `findByToAssetId(...).isEmpty()`. Any row blocks deletion
  (409 `SF-DOM-0120`).
- `AssetServiceImpl.usages` (~l.332): filters `getValidToRevision() == null`. Rows are never closed,
  so this matches all rows, including stale duplicates from every generation run.
- `BuildPlanner.affectedPages` (~l.106–146): walks `findByToAssetId` transitively with no revision
  filter, plus the payload indexes `pagesByTemplate` / `pagesBySection` for structural edges.

Writer: `GenerationService.materializeReferences` (~l.411) inserts content refs and render
dependencies on every run. The table (`006-asset-references.xml`) has indexes `idx_ref_to` and
`idx_ref_from` and nothing revision-aware.

## Goals

- Add repository queries for edges valid at a revision:
  - `findIncomingValidAt(toAssetId, revision)`: `valid_from_revision <= R AND (valid_to_revision IS NULL OR valid_to_revision > R)`
  - `findOutgoingValidAt(fromAssetId, revision)`
  - `findIncomingOpen(toAssetId)`, the current-state shortcut
  - Add a composite index `(to_asset_id, valid_to_revision)` in a new Liquibase changelog `015-…`,
    with dbms-scoped changesets where needed, following the existing PostgreSQL/H2 pattern.
- Migrate the readers:
  - `softDelete` guard: only **open** incoming edges from assets that are not deleted block deletion.
  - `usages`: open incoming edges. For time travel, accept an optional revision and return edges
    valid at R. Expose it as an optional `?revision=` on `GET /assets/{uuid}/usages` and regenerate
    the OpenAPI schema if the endpoint changes.
  - `BuildPlanner.affectedPages`: walk edges valid at `snapshot.revision()`. Also walk edges that
    were valid at `lastSuccessfulRevision` but have since closed, so removing a reference still
    rebuilds the page that dropped it (the page itself changed, so it's in `changedAssets`; add a
    test proving it). Keep the payload indexes only as a documented fallback, or delete them once
    `TEMPLATE` rows cover the case. Recommended: delete them, since one source of truth is better.
- Remove the reference inserts from `GenerationService.materializeReferences`. Keep the method only
  if something else still needs it; otherwise delete it with its `ContentReferenceService` call.
- Liquibase cleanup changeset: delete every existing row, then backfill edges for all current and
  historical versions by replaying `ReferenceMaterializer`'s extraction over `asset_version`. There's
  no production data (`M15` precedent), so a Java-based backfill run once at startup behind a
  property, or a documented `DELETE` plus "regenerate by re-saving", is acceptable. Choose, document,
  and test the choice.

## Acceptance criteria

- [ ] Delete guard: a media asset whose only referencing page no longer references it (edge closed)
      can be deleted without `force`. It is still blocked while an open edge exists.
- [ ] Usages returns exactly the open edges, with no duplicates after several generation runs.
      `?revision=R` returns the edges valid at R.
- [ ] Incremental generation test matrix: editing each of media, section template, page template,
      a page referenced via `$CMS_VALUE(page:…)$` and a page referenced via a link editor rebuilds
      exactly the expected pages. Running a full generation twice inserts **zero** reference rows.
- [ ] Removing a reference from page A, then editing the formerly referenced asset, does not rebuild A.
- [ ] Liquibase changeset applies cleanly on H2 (tests) and PostgreSQL (dev).
- [ ] `RevisionInvariantsTest` gains the invariant "edges valid at R == extract(payload valid at R)"
      for random histories.
- [ ] `./gradlew build` green.

## Out of scope

- Reason chains and a stored plan (`M22.1.*`).
- The §18.2 "navigation change expands to affected pages" rule (`M22.1.1`).
- The UI for usages. Existing consumers such as `media-detail-drawer.component.ts` keep working.

## Notes / hazards

- Render-time-only dependencies are **not** covered by persisted rows. Example: a template
  `$CMS_FOR` over `nav:` children whose *subtree* changed. The folder asset didn't change, but a
  `PAGE_REFERENCE` under it did. Document this gap explicitly, since it is `M22.1.1`'s job, so nobody
  "fixes" it by bringing back generation-time inserts.
- `BuildPlanner` currently queries once per visited asset. With revision-aware queries, load all
  edges valid at the snapshot revision once, as an in-memory reverse index, to keep 5,000-page
  incremental planning under the §2.1 G5 target (< 10 s).
