# Feature: Render pipeline (parallel)

**Spec:** §18.2 (VALIDATE + RENDER), §18.3 (output paths), §26.1 (perf).
**Area:** backend. **Epic:** M4.

## Goal

Run VALIDATE and RENDER over the plan deterministically, in parallel on virtual threads,
resolving output paths and detecting collisions.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-parallel-render-task.md](001-parallel-render-task.md) | M4.1.2, M2.4.2 |
| 2 | [002-output-paths-collision.md](002-output-paths-collision.md) | 1 |

## Feature exit criteria

- [ ] VALIDATE aborts before writing if ERROR-severity findings exist (§18.2).
- [ ] Render fans out over virtual threads bounded by `sf.generate.parallelism`.

## Dependencies

`M4:build-planner`, `M2:renderer`.
