---
id: M28.2.3
status: todo
depends: [M28.2.1, M28.2.2]
epic: m28-editor-publishing
feature: enforcement
area: backend
---

# M28.2.3 — Permission matrix walk test

## Context

`ArchivedProjectEndpointWalkTest` (M26.2.1: enumerates handlers from `RequestMappingHandlerMapping` and fails on
unlisted ones) is the model. Handlers in scope: `GenerationController`, `TargetController`, M27's release
controller(s) and schedules controller, `ProjectController` publish-policy endpoints. Epic decisions 2, 6–10.

## Goals

- `PublishPermissionMatrixTest`: for every mutating handler of the controllers above, an expectation table
  (`handler → rule`) where a rule is a minimum role, a `PublishPermission`, or "body-dependent" with the request
  bodies to try (incremental/default target, full, other target, pinned revision; schedule types with and without
  "then generate").
- Run every handler for `VIEWER`, `EDITOR` × each of the 16 policy subsets (invalid subsets skipped — they can't be
  stored), `DEVELOPER`, `PROJECT_ADMIN`, instance admin; assert allowed (any non-403 answer, e.g. `2xx`, `404`,
  `409`, `422`) vs `403 SF-API-0403` with the expected `permission` extension.
- The test fails when a mutating handler of these controllers has no entry, or an entry names a handler that no
  longer exists.

## Acceptance criteria

- [ ] Matrix green; negative control: temporarily granting `EDITOR` a `DEVELOPER` minimum on promote makes the test
      fail (documented in the task notes, not committed).
- [ ] Runtime within the normal test budget (reuse one context, seed fixtures once, reset the policy per case).
- [ ] `./gradlew build` green.

## Out of scope

- Content editing endpoints (their role rules don't change in M28).

## Notes / hazards

- "Allowed" means "not rejected by authorization": a `409 SF-GEN-0500` (run active) or `422` is a pass. Cancel
  runs between cases so the one-active-run rule doesn't mask a `403`.
