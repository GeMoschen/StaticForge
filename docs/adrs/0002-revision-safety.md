# ADR-0002 — Revision safety: identity/state split, per-project counter, version intervals

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** Tech lead (specced in `cms-specification.md` §5.2, §7)

## Context

Every mutation must be attributable and reversible (goal G2). "Soft deletes that append a tombstone and under a `WHERE deleted=false`…" style solutions do not give reproducible *point-in-time* reads of an entire project, nor make "restore an arbitrary revision" cheap.

## Decision

Make revision safety a first-class part of the schema, not an afterthought:

1. **Split identity from state.** An `asset` row (`Asset` entity) holds only what never changes — `uuid`, `project_id`, `asset_type`, `uid`, `created_at/by`. An `asset_version` row (`AssetVersion` entity) holds everything mutable — display name, folder, template ref, payload, `deleted` — together with its revision interval. `asset` is never updated except for an explicit UID rename.

2. **Per-project gapless revision counter.** `project_revision_counter` holds `next_revision` per project. `RevisionCounterRepository` allocates inside the mutating transaction so a rollback leaves no gap. The PostgreSQL implementation uses `UPDATE … RETURNING next_revision - 1`; the H2-compatible `JdbcRevisionCounterRepository` uses a `SELECT … FOR UPDATE` + `UPDATE` pair — one interface, two implementations, one contract.

3. **Version intervals.** Every `AssetVersion` carries `valid_from_revision` (inclusive) and `valid_to_revision` (exclusive, `NULL` = current). Reading the project *as of* revision R is a single indexed range query. Writing at revision R closes the current row (`valid_to_revision = R`) and inserts a new one. Deletion is a version row with `deleted = true`, so restore is an ordinary write.

4. **Revision interval as the concurrency token.** There is deliberately **no** `@Version` optimistic-lock column (spec §22.5); the `If-Match: "rev-{validFromRevision}"` header maps directly to the version interval, and mismatches surface as `SF-API-0409`.

5. **Mutation entry points carry a `RevisionContext`.** Every mutating service method accepts an explicit `RevisionContext` (project, user, comment) and calls `RevisionService.allocate(...)` first. A `@RevisionAware` type-level annotation, enforced by an ArchUnit rule, is the only place permitted to call repository save/delete — no write path can bypass revisioning (spec §21.2).

## Consequences

- Point-in-time reads (`AssetVersionRepository` range lookups) and project-wide rollback (`ProjectRestoreService`) become plain queries/writes rather than replay logic.
- The `RevisionDiff`/`DiffService`/`JsonDiffer` plus `HtmlBlockSplitter` implement §7.6 structural diff on canonical JSON with block-level rich-text diffing.
- Throughput per project is bounded by transaction duration (the counter row lock serializes writers per project only); acceptable and, per §7.3, the intended editorial trade-off.
- Append-only semantics mean history is never rewritten; compaction is reserved (`compaction` off in v1, §7.7).
