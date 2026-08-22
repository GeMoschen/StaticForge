---
id: M4.3.3
status: done
depends: [M4.3.1, M3.5.1]
epic: m4-generation
feature: targets
area: backend
---

# M4.3.3 — Asset copy stage (media + variants)

## Context

Implement §18.2 ASSETS stage: copy referenced media and requested variants to the target,
content-addressed.

## Goals

- Copy media + requested variants (from `$CMS_REF(..., variant="w800")` and content refs)
  to the target, skipping unchanged blobs by SHA-256.

## Acceptance criteria

- [ ] Only media actually referenced (and their variants) are copied.
- [ ] Unchanged blobs are skipped (no re-copy).

## Out of scope

- Post-processors (next feature).

## Notes / hazards

- Content-addressing makes the skip cheap and correct.
