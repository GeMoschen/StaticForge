---
id: M4.5.2
status: done
depends: [M4.5.1]
epic: m4-generation
feature: generation-api
area: backend
---

# M4.5.2 — SSE progress & run reporting

## Context

Stream generation progress per §18.5/§26.2.

## Goals

- Implement `GET /generations/{id}/events` (Server-Sent Events) streaming per-stage
  progress, error/warning grouping by code, and file counts.
- Record `GenerationRun` diagnostics JSON + log blob §18.5.
- Note the multi-node SSE affinity / Redis pub-sub requirement (§26.2) as config/documentation.

## Acceptance criteria

- [ ] The UI receives live stage progress + diagnostics.
- [ ] Run records carry the full diagnostics JSON for later review.

## Out of scope

- Multi-node Redis broker implementation (documented design; single-node for v1).

## Notes / hazards

- SSE needs connection affinity in multi-node; keep a seam for a broker.
