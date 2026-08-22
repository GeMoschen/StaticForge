---
id: M1.5.2
status: done
depends: [M1.5.1]
epic: m1-identity-revisions
feature: asset-api
area: backend
---

# M1.5.2 — Folder service & API

## Context

Folders are revisioned assets (§10.2) with a materialized path that powers subtree
queries and navigation.

## Goals

- Implement `FolderService` + `PathService`: one implicit root (`uid=root`, `path=/`),
  materialized `path` denormalized onto descendants, depth limit 12, 1,000-children soft
  warning at 80%.
- Implement subfolder move: rewrite subtree paths in a single revision; when > 100 assets
  touched, report the count before confirmation.
- Implement `GET/POST/PUT /folders/{uuid}`, `POST /folders/{uuid}/move`,
  `DELETE` (blocked while non-empty unless `?cascade=true`, `SF-DOM-0110`).

## Acceptance criteria

- [ ] Tree listing (`?depth=`) and prefix subtree queries work off `idx_av_folder_path`.
- [ ] Move rewrites every descendant path atomically in one revision.
- [ ] Deleting a non-empty folder returns `409 SF-DOM-0110` unless `cascade`.

## Out of scope

- Navigation *computation* (M5); folders here are just the tree.

## Notes / hazards

- Folder path ≠ output path (§10.2); don't conflate them.
