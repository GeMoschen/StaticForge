---
id: M1.6.1
status: done
depends: [M1.4.3]
epic: m1-identity-revisions
feature: diff-restore
area: backend
---

# M1.6.1 — Diff service

## Context

Implement the structural diff of §7.6 over the canonical JSON payload with a field-path
walker.

## Goals

- Implement `DiffService.diff(projectId, revision)` producing a structural diff of
  touched assets against `r-1`.
- Walk canonical JSON payloads (`JsonNode`) with field paths; richtext fields diff at
  block level (§7.6).
- Return a machine-readable + human-summarizable diff usable by the M6 diff viewer.

## Acceptance criteria

- [ ] Diff of two payload versions yields correct add/remove/change entries with field paths.
- [ ] Richtext diffs at block level (not raw string diff).

## Out of scope

- Rendering the diff (M6 UI).

## Notes / hazards

- Must be deterministic and cheap for large payloads.
