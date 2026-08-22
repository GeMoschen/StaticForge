---
id: M4.1.1
status: done
depends: [M1.4.2]
epic: m4-generation
feature: build-planner
area: backend
---

# M4.1.1 — Generation service & run queue

## Context

Implement the run lifecycle + queueing of §18.5 and §18.1.

## Goals

- Implement `GenerationService` and the `generation_run` record (§18.5) with status
  machine QUEUED/RUNNING/SUCCESS/PARTIAL/FAILED/CANCELLED, counts, timings, diagnostics
  JSON, log blob ref.
- Enforce one active run per project (`SF-GEN-0500`, `409`) via a `FOR UPDATE SKIP LOCKED`
  claim row (§26.2).
- Parse the §18.1 request body (mode INCREMENTAL/FULL, revision null=current, channels,
  targetId, scope folderPath/assetUuids, comment).

## Acceptance criteria

- [ ] Concurrent requests to start runs yield one active + `409` for the rest.
- [ ] Run rows persist complete records with counts/timings/diagnostics.

## Out of scope

- The actual plan/render (next tasks); here the orchestration shell.

## Notes / hazards

- Snapshot loads read-only at the pinned revision so a long build never holds locks
  (§21.4).
