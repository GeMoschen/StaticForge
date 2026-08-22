---
id: M7.3.2
status: done
depends: [M0.2.2]
epic: m7-hardening
feature: security
area: backend
---

# M7.3.2 — Audit log & observability completion

## Context

Complete the §26.4 telemetry and the §26.3 audit trail.

## Goals

- Add `audit_log` covering auth, membership, channel and target changes (retained 1 year).
- Finalize metrics (§26.4): `sf.revision.allocate`, `sf.render.duration`, 
  `sf.generation.duration/files`, `sf.media.upload.bytes`, cache hit ratios, HTTP
  histograms.
- OpenTelemetry tracing across request → service → render; alert rules (generation
  failure rate, p95 save, refresh-reuse detections, blob disk headroom).

## Acceptance criteria

- [x] Audit events recorded + queryable; metrics/tracing/alerts wired.

## Out of scope

- Long-term log archival infrastructure (runbook references).

## Notes / hazards

- Audit log is separate from content revisions (§26.3).
