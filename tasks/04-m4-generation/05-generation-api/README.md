# Feature: Generation API & progress

**Spec:** §20.2 (generation endpoints), §18.5 (SSE).
**Area:** backend. **Epic:** M4.

## Goal

Expose the generation REST API and SSE progress events.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-generation-rest-api.md](001-generation-rest-api.md) | M4.1.1, M4.4.1 |
| 2 | [002-sse-progress-reporting.md](002-sse-progress-reporting.md) | 1 |

## Feature exit criteria

- [ ] Run history/status/cancel/promote endpoints work; `Idempotency-Key` honored on start.
- [ ] `GET /generations/{id}/events` streams stage progress via SSE.

## Dependencies

`M4:build-planner`, `M4:postprocess`.
