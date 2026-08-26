---
id: M8.1.5
status: todo
depends: [M8.1.3]
epic: m8-navigation-rewrite
feature: navigation-store
area: backend
---

# M8.1.5 — Navigation store REST API

## Context

Expose the navigation store the same way Pages/Media are exposed: folder CRUD (reusing
the generic folder endpoints, scoped to `NAVIGATION`) plus `PageReference` CRUD, so the
UI (`M8.1.6`) has something to bind to.

## Goals

- `NavigationController` (or extend the existing generic folder controller with the
  `NAVIGATION` scope if one already parameterizes by scope — check before adding a
  parallel controller):
  - `GET /projects/{projectKey}/navigation/tree` — full folder tree with resolved
    `startNode` hrefs (via `NavigationService.tree`).
  - `POST /projects/{projectKey}/navigation/folders` — create folder (parent uuid,
    displayName).
  - `PATCH /projects/{projectKey}/navigation/folders/{uuid}` — rename / set `startNode`
    (`If-Match` optimistic concurrency, matching Pages/Media conventions).
  - `POST /projects/{projectKey}/navigation/folders/{uuid}/move`.
  - `DELETE /projects/{projectKey}/navigation/folders/{uuid}` — cascade behavior
    matches `FolderService.delete`.
  - `POST /projects/{projectKey}/navigation/references` — create `PageReference`
    (target kind + uuid, optional label override).
  - `PATCH /projects/{projectKey}/navigation/references/{uuid}` — update target/label.
  - `DELETE /projects/{projectKey}/navigation/references/{uuid}`.
  - `GET /projects/{projectKey}/navigation/references/{uuid}/resolve` — resolved page
    uuid + path, for the UI's live preview (`NavigationService.resolve`).
- DTOs mirror the Page/Media API's shape conventions (summary vs. detail, revision/etag
  fields) — do not invent a new response shape style.
- OpenAPI schema updated (generated client used by the Angular `*.service.ts` files
  depends on this).

## Acceptance criteria

- [ ] Full CRUD + move + resolve endpoints implemented, authorized the same way as the
      Pages API (project role checks).
- [ ] `If-Match`/optimistic-concurrency enforced on every mutating endpoint.
- [ ] OpenAPI schema regenerates cleanly and the frontend's generated
      `components['schemas']` types include the new navigation types.
- [ ] Integration tests cover create/rename/move/delete and reference target
      validation errors (400 on dangling/wrong-kind target).

## Out of scope

- UI (`M8.1.6`), URL registry endpoints (`M8.2.4`).

## Notes / hazards

- Check whether folders already have a scope-parameterized generic controller before
  writing a second one — Pages/Media may already expose `/folders` per scope, in which
  case only the `PageReference`-specific endpoints and the tree/resolve reads are new.
