# Feature: Global store REST API

**Spec:** Extends §20.1 (conventions: RFC 9457 problems, `If-Match: "rev-{n}"`, 404 vs 403)
and §20.2 (endpoint catalogue).

## Goal

Expose `GlobalSetService` under `/api/v1/projects/{projectKey}/globals`, with the role
split decided for this epic: schema changes need `DEVELOPER`, value changes need `EDITOR`,
reads need `VIEWER`. Folder operations keep using the existing `FolderController` with
`scope=GLOBALS`. Regenerate the OpenAPI schema for the UI.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-globals-controller.md](001-globals-controller.md) | `M17.1.2` |

## Feature exit criteria

- [ ] All set operations are reachable over REST with the correct role per operation.
- [ ] `ui/src/app/core/api/generated/schema.d.ts` is regenerated and contains the new
      endpoints and DTOs.

## Dependencies

`M17.1` (domain), `M1:security` (`ProjectAuthorizationService`, `ProjectRoleExpr`).
