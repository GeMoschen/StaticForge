---
id: M4.5.1
status: done
depends: [M4.1.1, M4.4.1]
epic: m4-generation
feature: generation-api
area: backend
---

# M4.5.1 — Generation REST API

## Context

Implement the §20.2 generation + targets endpoints.

## Goals

- `GET /generations` (history), `POST /generations` (start), `GET /generations/{id}`
  (status + diagnostics), `POST /generations/{id}/cancel`, `POST /generations/{id}/promote`.
- Honour `Idempotency-Key` on start (§20.1).
- Target CRUD under `/targets` (§20.2).

## Acceptance criteria

- [ ] A start returns the run id; a duplicate (idempotency) doesn't spawn a second run.
- [ ] Cancel/status/promote behave per §18.5 states.

## Out of scope

- SSE (next task).

## Notes / hazards

- Controllers thin; service owns transactions.
