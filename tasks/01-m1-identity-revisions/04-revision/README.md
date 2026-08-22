# Feature: Revision counter & versioning

**Spec:** §7 (entire).
**Area:** backend. **Epic:** M1.

## Goal

Implement the revision machinery that makes the system revision-safe: the per-project
counter, the revision record, the version-interval read/write algorithm, and optimistic
concurrency.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-revision-counter.md](001-revision-counter.md) | M1.3.1 |
| 2 | [002-revision-service.md](002-revision-service.md) | 1 |
| 3 | [003-version-intervals-concurrency.md](003-version-intervals-concurrency.md) | 2 |

## Feature exit criteria

- [ ] Revision ids are gapless and contention-safe per project (§7.3).
- [ ] Reads-at-revision use the single indexed query; writes close/open version rows.
- [ ] `If-Match`/`ETag` produces `409` with both payloads on mismatch.

## Dependencies

`M1:asset-identity` (asset/asset_version entities).
