---
id: M7.4.1
status: done
depends: [M4.3.2]
epic: m7-hardening
feature: operations
area: backend
---

# M7.4.1 — Project export/import (ZIP)

## Context

Implement project export/import as a portability/migration path (§26.5).

## Goals

- Export a project to a ZIP: assets JSON + blobs + a manifest (§26.5).
- Import: create a new project (or restore into one) with new UUIDs, provenance in
  `payload.origin` (§6.1).
- Exercise the import/copy UID-resolution semantics (§6.1).

## Acceptance criteria

- [x] Export → import round-trips content, media, templates and structures.
- [x] Imported assets get fresh UUIDs + `payload.origin` provenance.

## Out of scope

- Cross-instance migration UI (CLI/API sufficient).

## Notes / hazards

- Blobs are content-addressed and immutable — pack them deterministically (§26.5).
