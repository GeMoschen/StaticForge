# Feature: Targets & atomic publish

**Spec:** §18.4 (targets, atomic publish), §18.2 (ASSETS + WRITE stages).
**Area:** backend. **Epic:** M4.

## Goal

Implement `generation_target` CRUD, the asset-copy stage, and atomic publish for
filesystem (staged + symlink), ZIP, and S3.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-targets-atomic-publish.md](001-targets-atomic-publish.md) | M4.1.1 |
| 2 | [002-zip-s3-targets.md](002-zip-s3-targets.md) | 1 |
| 3 | [003-asset-copy-stage.md](003-asset-copy-stage.md) | 1, M3.5.1 |

## Feature exit criteria

- [ ] Filesystem publish is atomic (staged dir + symlink flip); failed runs don't touch
      `current`.
- [ ] ZIP + S3 targets work; S3 invalidates only changed keys.

## Dependencies

`M4:build-planner`, `M3:media` (blobs/variants).
