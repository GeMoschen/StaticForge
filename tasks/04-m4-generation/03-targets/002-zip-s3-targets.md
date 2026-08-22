---
id: M4.3.2
status: done
depends: [M4.3.1]
epic: m4-generation
feature: targets
area: backend
---

# M4.3.2 — ZIP & S3 targets

## Context

Implement the two non-filesystem targets of §18.4.

## Goals

- ZIP target: bundle output into a portable archive (+ optionally the export manifest
  used later by M7 export/import).
- S3 target: write to a key prefix, then update CloudFront/Nginx origin path or invalidate
  only the changed keys (derived from the run diff, not a wildcard).

## Acceptance criteria

- [ ] ZIP target produces a complete archives.
- [ ] S3 target uploads changed keys and invalidates only those keys.

## Out of scope

- Actual CDN provisioning (config/runbook only).

## Notes / hazards

- S3 invalidation must be incremental (diff-based), not wildcard (§18.4).
