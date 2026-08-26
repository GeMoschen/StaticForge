---
id: M8.2.4
status: todo
depends: [M8.2.2]
epic: m8-navigation-rewrite
feature: url-registry
area: backend
---

# M8.2.4 — URL registry REST API

## Context

Expose list/override/reset for the project settings UI (`M8.2.5`).

## Goals

- `UrlRegistryController` under project settings' API namespace:
  - `GET /projects/{projectKey}/url-registry` — paginated list, filterable by
    `channelKey`, `area`, and a free-text search over the resolved URL/`PageReference`
    label (for the settings table).
  - `PATCH /projects/{projectKey}/url-registry/{id}` — manual override (body: `url`),
    delegates to `UrlRegistryService.override`.
  - `POST /projects/{projectKey}/url-registry/reset` — body selects scope: single
    entry id, `{channelKey}`, `{area}`, or whole-project (`{}`); delegates to
    `UrlRegistryService.reset`.
- Authorization matches other project-settings-mutating endpoints (PROJECT_ADMIN /
  DEVELOPER — confirm exact role against how `ChannelService` CRUD is gated and match
  it).
- OpenAPI schema updated for the frontend generated client.

## Acceptance criteria

- [ ] List endpoint supports the three filters plus pagination; response includes
      `pageReferenceUuid`, a human-readable label (join through `PageReference`'s
      `displayName`/label override), `channelKey`, `area`, `url`, `overridden`,
      `assignedAt`.
- [ ] Override endpoint round-trips and is reflected in the next list call.
- [ ] Reset endpoint correctly scopes to each of the four levels; integration test per
      level.
- [ ] Unauthorized roles get 403, matching the existing project-settings authorization
      test pattern.

## Out of scope

- UI (`M8.2.5`).

## Notes / hazards

- Reset is destructive and irreversible (assigned URLs are gone, next resolve
  recomputes) — this is by design, but the settings UI (`M8.2.5`) must surface a
  confirmation before calling it; note that expectation here since this task defines the
  contract the UI relies on.
