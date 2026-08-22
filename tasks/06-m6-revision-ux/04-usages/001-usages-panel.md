---
id: M6.4.1
status: done
depends: [M2.2.3]
epic: m6-revision-ux
feature: usages
area: fullstack
---

# M6.4.1 — Usages panel

## Context

Implement "where is this used?" (§5.4) front to back.

## Goals

- Backend: ensure `/assets/{uuid}/usages` returns inbound references by kind + source path.
- Frontend: a usages panel on media/templates/pages listing referencing assets; shown
  before any delete (§24.5 #5).

## Acceptance criteria

- [x] Deleting a media file used by 3 pages lists them before confirmation.

## Out of scope

- Broken-link *report* (build warning covers dangling; a dedicated report is post-v1).

## Notes / hazards

- Reuse `asset_reference` partial index on `to_asset_id`.
