# Feature: Diff & restore

**Spec:** §7.6 (diff, restore).
**Area:** backend. **Epic:** M1.

## Goal

Compute structural diffs between revisions and implement asset-level and project-wide
restore as append-only operations.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-diff-service.md](001-diff-service.md) | M1.4.3 |
| 2 | [002-restore-api.md](002-restore-api.md) | 1 |

## Feature exit criteria

- [ ] `GET /revisions/{r}/diff` returns a structural field-path diff, richtext at block
      level.
- [ ] Restore writes a new revision; project-wide rollback requires `PROJECT_ADMIN`.

## Dependencies

`M1:revision`, `M1:asset-api`.
