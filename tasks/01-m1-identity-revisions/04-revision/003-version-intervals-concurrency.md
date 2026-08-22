---
id: M1.4.3
status: done
depends: [M1.4.2]
epic: m1-identity-revisions
feature: revision
area: backend
---

# M1.4.3 — Version intervals & optimistic concurrency

## Context

Implement the §7.4 write algorithm and the §7.5 optimistic-concurrency protocol.

## Goals

- Implement version-interval writes: close current row (`SET valid_to_revision = R
  WHERE asset_id = :a AND valid_to_revision IS NULL`) then insert a new row at `R`.
- Implement read-at-revision via the §7.4 query + index; deletion as `deleted=true` row.
- Implement optimistic concurrency: every read returns `baseRevision`; writes require
  `If-Match: "rev-N"`; on mismatch answer `409` with a problem document carrying both
  versions' payloads (§7.5, §20.3 error example).

## Acceptance criteria

- [ ] No two rows are valid for the same asset at the same revision.
- [ ] `If-Match` mismatch returns `409` (`SF-API-0409`), missing header `412`
      (`SF-API-0412`), with `expectedRevision`/`currentRevision`.

## Out of scope

- Diff/merge UI (M6); the problem payload just carries data.

## Notes / hazards

- The revision interval doubles as the concurrency token — no `@Version` column (§22.5).
