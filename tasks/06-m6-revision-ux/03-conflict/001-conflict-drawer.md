---
id: M6.3.1
status: done
depends: [M3.4.3]
epic: m6-revision-ux
feature: conflict
area: frontend
---

# M6.3.1 — Conflict drawer (field-level merge)

## Context

Turn the raw `409` from M3 into the §24.6 "conversation".

## Goals

- A drawer comparing both versions field by field with per-field keep-mine/take-theirs,
  who changed what and when.
- Resolve → merge + resubmit with the correct `If-Match`.
- Never silently overwrite (§7.5).

## Acceptance criteria

- [x] Two-browser edit → second save shows the drawer → per-field merge → save succeeds.

## Out of scope

- Auto-merge heuristics (future).

## Notes / hazards

- Reuse the `409` problem document's dual payloads.

## Backend status (M6.3.1)

The `SF-API-0409` problem document now carries both version payloads: `base` (state at the
client's `expectedRevision`, looked up via `AssetVersionRepository.findValidAtRevision`) and
`theirs` (the current committed version), alongside the existing
`expectedRevision`/`currentRevision`/`changedBy`/`changedAt`. Implemented in
`AssetServiceImpl.checkExpectedRevision`; covered by
`AssetRevisionIntegrationTests.conflictDocumentCarriesBothVersionPayloads`. Frontend
conflict-drawer merge UI still open — `status` left `todo`.
