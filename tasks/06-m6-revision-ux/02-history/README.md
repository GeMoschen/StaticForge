# Feature: History (timeline, diff, restore)

**Spec:** §24.5 (#9 revisions), §7.6.
**Area:** frontend. **Epic:** M6.

## Goal

Build the full-page revision timeline with filters, the side-by-side diff viewer, and
restore/rollback.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-revision-timeline.md](001-revision-timeline.md) | M6.1.1 |
| 2 | [002-diff-viewer-restore.md](002-diff-viewer-restore.md) | 1, M1.6.2 |

## Feature exit criteria

- [ ] Timeline filters by user/asset/type; side-by-side diff; restore + rollback both
      work and create new revisions.

## Dependencies

`M6:revision-spine`, `M1:diff-restore`.
