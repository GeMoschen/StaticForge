---
id: M17.2.1
status: done
depends: [M17.1.2]
epic: m17-global-store
feature: api
area: backend
---

# M17.2.1 — `GlobalsController` + DTOs + OpenAPI regeneration

## Context

Existing store controllers live in `server/sf-api/src/main/java/com/acme/staticforge/api/`:

- `PageTemplateController` (`/page-templates`): `@PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER|DEVELOPER + ")")`
  per method.
- `NavigationController` (`/navigation`).
- `FolderController`: `GET ?scope=`, `POST`, `PUT /{uuid}`, `POST /{uuid}/move`, `DELETE /{uuid}`.

Generic asset operations (uid change, usages, restore) are on `AssetController`. Problems
come from `ProblemFactory` (sf-common). Concurrency uses `If-Match: "rev-{n}"`.

## Goals

- `GlobalsController` at `/api/v1/projects/{projectKey}/globals`:

  | Method | Path | Role | Body / result |
  |---|---|---|---|
  | GET | `/` | VIEWER | `?folder=<uuid>` → `List<GlobalSetSummaryView>` (uuid, uid, displayName, folderPath, revision) |
  | GET | `/{uuid}` | VIEWER | `?revision=` (time travel) → `GlobalSetView` (incl. `contentDefinition`, `compiledDefinition`, `content`) |
  | POST | `/` | DEVELOPER | `CreateGlobalSetRequest(parentFolderUuid, displayName, contentDefinition, comment)` → 201 |
  | PUT | `/{uuid}/schema` | DEVELOPER | `UpdateGlobalSetSchemaRequest(contentDefinition, comment)` + `If-Match` |
  | PUT | `/{uuid}/content` | EDITOR | `UpdateGlobalSetContentRequest(content, comment)` + `If-Match` |
  | DELETE | `/{uuid}` | DEVELOPER | soft delete (409 problem while referenced) |

- Moving, renaming the uid, usages and restore stay on the generic
  `AssetController`/`FolderController` endpoints. Document this in `docs/api.md` instead
  of duplicating them.
- CDL validation of a draft set schema reuses `POST /projects/{p}/cdl/validate`. If the
  set-specific restriction (`M17.1.2`'s new diagnostic) can't be expressed there, add an
  optional `kind=GLOBAL_SET` query parameter rather than a second endpoint.
- Every response carries `ETag: "rev-{n}"`, like page endpoints.
- Regenerate OpenAPI (`OpenApiGeneratorMain`) and `ui` `npm run generate:api`.
- API tests (`GlobalsApiTest`): role matrix (VIEWER can't write, EDITOR can write content
  but gets 403 on schema, DEVELOPER can do both), 404 for another project's uuid (no
  existence leak), 409 on stale `If-Match`, 422 CDL diagnostics shape.

## Acceptance criteria

- [ ] All six endpoints exist with the role matrix above, and `GlobalsApiTest` proves it.
- [ ] Requests for a `GLOBAL_SET` uuid from another project return 404, not 403 (§8.4).
- [ ] `ETag`/`If-Match` behave exactly like `PageController`.
- [ ] `docs/api.md` lists the endpoints. `schema.d.ts` is regenerated and `ui` `npm run build` is green.
- [ ] `./gradlew :server:sf-api:test` green.

## Out of scope

- The UI client service (`M17.4.1`).
- A per-channel override of global values (not planned).

## Notes / hazards

- Splitting `/schema` and `/content` into two endpoints is the point: a single `PUT`
  accepting both would force a role check on which fields changed, and that can drift.
- Both PUTs write a new version of the same asset. Two users editing schema and values at
  the same time conflict through `If-Match`, which is intended. The UI (`M17.4.1`) must
  reload after a 409 instead of retrying blindly.
