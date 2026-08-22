---
id: M6.2.1
status: done
depends: [M6.1.1]
epic: m6-revision-ux
feature: history
area: frontend
---

# M6.2.1 — Revision timeline

## Context

Implement the full-page Revisions screen (§24.5 #9): the expanded spine.

## Goals

- Full-page timeline (virtual scroll) with filters by user, asset, and change type.
- Each entry links to time-travel/diff.
- Consume `GET /revisions` (`?since/?userId/?assetUuid`).

## Acceptance criteria

- [x] Timeline renders and filters correctly at scale (virtual scroll).

## Out of scope

- Diff viewer (next task).

## Notes / hazards

- Reuse the spine's tick data shape.

## Backend status (M6.2.1)

`GET /api/v1/projects/{p}/revisions` now accepts `?since=<revisionId>`,
`?userId=<numeric>` and `?assetUuid=<uuid>` alongside pagination. Implemented in
`RevisionServiceImpl.findRecent(projectId, since, userId, assetUuid, pageable)` backed by
`RevisionRepository.findFiltered` (JPQL for `since`/`userId`) plus a summary-JSON scan for
`assetUuid`. Covered by `RevisionFilterIntegrationTest`. Frontend (virtual-scroll timeline
consuming these params) still open — `status` left `todo`.
