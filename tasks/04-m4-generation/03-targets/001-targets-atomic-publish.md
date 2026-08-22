---
id: M4.3.1
status: done
depends: [M4.1.1]
epic: m4-generation
feature: targets
area: backend
---

# M4.3.1 — Target CRUD & filesystem atomic publish

## Context

Implement `generation_target` (§18.4) and the atomic filesystem publish + promote path.

## Goals

- Model `generation_target` (name, type FILESYSTEM|ZIP|S3, config JSON, is_default) with
  the §20.2 target CRUD endpoints.
- Implement the **WRITE** stage for filesystem: write to `{root}/builds/{runId}/`, then
  flip `{root}/current` symlink after a successful run; keep last N builds (default 5).
- Implement `POST /generations/{runId}/promote` for instant rollback.

## Acceptance criteria

- [ ] A failed run leaves `current` untouched.
- [ ] `promote` swaps `current` to a prior successful build.

## Out of scope

- ZIP/S3 (next task).

## Notes / hazards

- Symlink flip must be atomic on the target OS.
