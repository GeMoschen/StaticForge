# StaticForge CMS — API reference

Human-readable summary of the REST surface. The machine-readable contract is generated from the controllers into `server/sf-app/build/openapi/openapi.json` (68 paths), and a TypeScript client is generated from it for the Angular app (§4.2, §23.1). The spec's normative endpoint catalogue is `cms-specification.md` §20; this page is a navigable index with the error codes appended.

## 1. Conventions

- Base path `/api/v1`, JSON except media upload/download.
- Errors are RFC 9457 `application/problem+json` with a `code` extension (see section 5).
- Pagination `?page=0&size=50&sort=displayName,asc`; envelope `{ "content": [...], "page": {...} }`.
- Concurrency via `ETag`/`If-Match` (`"rev-{validFromRevision}"`); idempotency via `Idempotency-Key` (24 h) on `POST` creates.

## 2. Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/auth/login` | username+password → access token + refresh cookie |
| `POST` | `/api/v1/auth/refresh` | rotates refresh, returns access token |
| `POST` | `/api/v1/auth/logout` | revokes refresh family |
| `GET` | `/api/v1/auth/me` | principal, memberships, capabilities |
| `POST` | `/api/v1/auth/password` | change own password |

## 3. Projects & membership

| Method | Path | Role |
|---|---|---|
| `GET` | `/projects` | authenticated (member projects only) |
| `POST` | `/projects` | INSTANCE_ADMIN |
| `GET`/`PUT` | `/projects/{key}` | VIEWER / PROJECT_ADMIN |
| `POST` | `/projects/{key}/archive` | INSTANCE_ADMIN |
| `GET` | `/projects/{key}/members` | VIEWER |
| `PUT`/`DELETE` | `/projects/{key}/members/{userId}` | PROJECT_ADMIN |

## 4. Assets (generic)

| Method | Path |
|---|---|
| `GET` | `/projects/{projectKey}/assets` (`?type=`, `?q=`, `?folder=`) |
| `GET` | `/projects/{projectKey}/assets/{uuid}` |
| `GET` | `/projects/{projectKey}/assets/{uuid}/usages` (`?revision=`) |
| `GET` | `/projects/{projectKey}/assets/{uuid}/history` |
| `GET` | `/projects/{projectKey}/assets/{uuid}/versions/{revision}` |
| `POST` | `/projects/{projectKey}/assets/{uuid}/restore` |
| `PATCH` | `/projects/{projectKey}/assets/{uuid}/uid` |
| `POST` | `/projects/{projectKey}/assets/{uuid}/move` |
| `DELETE` | `/projects/{projectKey}/assets/{uuid}` |

## 5. Pages

| Method | Path |
|---|---|
| `GET`/`POST` | `/projects/{projectKey}/pages` |
| `GET`/`PUT`/`DELETE` | `/projects/{projectKey}/pages/{uuid}` |
| `PATCH` | `/projects/{projectKey}/pages/{uuid}/content` (JSON-Merge-Patch) |
| `POST` | `/projects/{projectKey}/pages/{uuid}/bodies/{body}/sections` |
| `PUT` | `/projects/{projectKey}/pages/{uuid}/bodies/{body}/order` |
| `DELETE` | `/projects/{projectKey}/pages/{uuid}/bodies/{body}/sections/{instanceId}` |
| `POST` | `/projects/{projectKey}/pages/{uuid}/duplicate` |

## 6. Folders

| Method | Path |
|---|---|
| `GET`/`POST` | `/projects/{projectKey}/folders` |
| `PUT`/`DELETE` | `/projects/{projectKey}/folders/{uuid}` |
| `POST` | `/projects/{projectKey}/folders/{uuid}/move` |

## 7. Media

| Method | Path |
|---|---|
| `GET`/`POST` | `/projects/{projectKey}/media` |
| `POST` | `/projects/{projectKey}/media/bulk` |
| `PUT` | `/projects/{projectKey}/media/{uuid}` |
| `POST` | `/projects/{projectKey}/media/{uuid}/replace` |
| `GET` | `/projects/{projectKey}/media/{uuid}/binary` (`?variant=`) |
| `GET` | `/projects/{projectKey}/media/{uuid}/thumbnail` |

## 8. Templates (section, page) & structures

| Method | Path |
|---|---|
| `GET`/`POST` | `/projects/{projectKey}/section-templates` |
| `GET`/`PUT`/`DELETE` | `/projects/{projectKey}/section-templates/{uuid}` |
| `GET`/`POST` | `/projects/{projectKey}/page-templates` |
| `GET`/`PUT`/`DELETE` | `/projects/{projectKey}/page-templates/{uuid}` |
| `PUT`/`DELETE` | `/projects/{projectKey}/{templateKind}/{uuid}/channels/{channelKey}` |
| `GET`/`POST` | `/projects/{projectKey}/structures` |
| `GET`/`PUT`/`DELETE` | `/projects/{projectKey}/structures/{uuid}` |
| `GET` | `/projects/{projectKey}/structures/{uuid}/preview` |
| `POST` | `/projects/{projectKey}/cdl/validate` |
| `POST` | `/projects/{projectKey}/octl/validate` |

## 9. Channels & targets

| Method | Path |
|---|---|
| `GET`/`POST` | `/projects/{projectKey}/channels` |
| `PUT`/`DELETE` | `/projects/{projectKey}/channels/{key}` |
| `POST` | `/projects/{projectKey}/channels/{key}/enable` \| `/disable` |
| `GET` | `/projects/{projectKey}/channels/{key}/delete-preview` |
| `GET`/`POST` | `/projects/{projectKey}/targets` |
| `PUT`/`DELETE` | `/projects/{projectKey}/targets/{id}` |

## 10. Generation

| Method | Path |
|---|---|
| `GET`/`POST` | `/projects/{projectKey}/generations` |
| `GET` | `/projects/{projectKey}/generations/{runId}` |
| `GET` | `/projects/{projectKey}/generations/{runId}/events` (SSE) |
| `POST` | `/projects/{projectKey}/generations/{runId}/cancel` |
| `POST` | `/projects/{projectKey}/generations/{runId}/promote` |

## 11. Revisions & restore

| Method | Path |
|---|---|
| `GET` | `/projects/{projectKey}/revisions` (`?since=`, `?userId=`, `?assetUuid=`) |
| `GET` | `/projects/{projectKey}/revisions/{revisionId}` |
| `GET` | `/projects/{projectKey}/revisions/{revisionId}/diff` |
| `POST` | `/projects/{projectKey}/restore` (project-wide rollback) |

## 12. Preview

| Method | Path |
|---|---|
| `GET` | `/projects/{projectKey}/preview/pages/{uuid}` (`?revision=`, `?channel=`) — page preview by identity; the server resolves content/bodies/meta from the database, the client never sends rendered data |
| `POST` | `/projects/{projectKey}/preview/section` |
| `GET` | `/projects/{projectKey}/preview/pages/{uuid}/share` (issue a share link) |
| `GET` | `/projects/{projectKey}/preview/share` (`?t=`, render via a share token) |

## 13. System

| Method | Path |
|---|---|
| `GET` | `/api/v1/status` (liveness/readiness; in addition to `/actuator/health`) |

## 14. Error catalogue

Codes from `cms-specification.md` Appendix B, annotated with where they are raised in code. `ProblemFactory` (in `sf-common`) constructs the `problem+json` bodies.

### API (`SF-API-*`)

| Code | HTTP | Raised by / notes |
|---|---|---|
| `SF-API-0400` | 400 | malformed request body — `ProblemFactory`; invalid channel output settings carry a `fieldErrors` array of `{field, message}` — `ChannelServiceImpl` |
| `SF-API-0401` | 401 | missing/expired access token — `ProblemEntryPoint` |
| `SF-API-0403` | 403 | role insufficient — `ProjectAuthorizationService` |
| `SF-API-0404` | 404 | not found / not visible (does not leak existence, §8.4) |
| `SF-API-0409` | 409 | revision conflict (`If-Match` mismatch), §7.5 |
| `SF-API-0412` | 412 | `If-Match` missing on a mutating request |
| `SF-API-0413` | 413 | upload exceeds configured limit (§11.5) |
| `SF-API-0415` | 415 | MIME type not allowed (Tika sniff, §11.4) |
| `SF-API-0422` | 422 | CDL validation failed (field-level details); structural page content findings on save carry an `issues` array — `PageContentValidation` |
| `SF-API-0423` | 423 | account locked (login lockout, §9.5) — *implemented addition* |
| `SF-API-0429` | 429 | rate limit exceeded (login) |
| `SF-API-0500` | 500 | internal error — *implemented addition* |

### Domain (`SF-DOM-*`)

| Code | HTTP | Raised by |
|---|---|---|
| `SF-DOM-0101` | 422 | UID already taken (probe exhaustion) — `UidGenerator` |
| `SF-DOM-0102` | 422 | reserved UID — `UidGenerator` |
| `SF-DOM-0103` | 422 | folder depth limit exceeded — `PathService.MAX_DEPTH` — *implemented addition* |
| `SF-DOM-0110` | 409 | folder not empty — `FolderService` |
| `SF-DOM-0120` | 409 | asset still referenced by an open edge from a non-deleted asset (delete without `force`) — `AssetServiceImpl` |
| `SF-DOM-0130` | 422 | page reference folder target has no page in its subtree — `PageReferenceServiceImpl` (a section template outside a body's `allow` list is `SF-API-0422` with an `allow` issue) |
| `SF-DOM-0140` | 409 | project key already exists — *implemented addition* |

### Template (`SF-TPL-*`, `SF-CDL-*`)

Defined in `template.diagnostic.DiagnosticCodes` (see [template-developer guide](template-developer-guide.md) for the full table):

- OCTL (`SF-TPL-01xx` / `02xx` / `03xx`) — compile errors and warnings per §16.11.
- CDL (`SF-CDL-01xx` / `02xx`) — CDL compile/validation errors; these are not enumerated in the spec but are stable, machine-readable codes.

### Generation (`SF-GEN-*`)

Defined across `generate.GenerationDiagnosticCodes` and `generate.GenerationService` (build-time, no HTTP status unless noted):

| Code | Severity | Meaning | Raised by |
|---|---|---|---|
| `SF-GEN-0110` | error | output path collision | `RenderPipeline` (`COLLISION_CODE`) |
| `SF-GEN-0120` | error (per page) | content incomplete; page held back, run `PARTIAL` | `GenerationDiagnosticCodes` (`RenderPipeline.incompletePages`) |
| `SF-GEN-0210` | warning | no channel template for enabled channel | `GenerationDiagnosticCodes` |
| `SF-GEN-0220` | warning | reference to a deleted asset (`$CMS_REF`, `$CMS_INCLUDE`, body section); renders empty | `GenerationRenderer` |
| `SF-GEN-0301` | warning | `raw` filter on a plain-text editor | (spec §16.3 — raised via `SF-TPL-0301` at compile time) |
| `SF-GEN-0410` | warning | navigation cycle truncated | `GenerationDiagnosticCodes` |
| `SF-GEN-0500` | 409 | a generation run is already active | `GenerationService` (`CONFLICT_CODE`) |
