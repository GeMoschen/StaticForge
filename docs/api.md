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
| `GET`/`POST` | `/projects/{projectKey}/folders` (`scope` = `PAGES`, `MEDIA`, `NAVIGATION`, `TEMPLATES`, `GLOBALS` or `CONTENT`) |
| `PUT`/`DELETE` | `/projects/{projectKey}/folders/{uuid}` |
| `POST` | `/projects/{projectKey}/folders/{uuid}/move` |

### 6.1 Globals (M17)

Global property sets. Schema and values are separate endpoints because they need different roles. Every response carries `ETag: "rev-{n}"`, and both `PUT`s require `If-Match`, as for pages.

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/projects/{projectKey}/globals` | `VIEWER` | `?folder=<uuid>` restricts to one folder |
| `GET` | `/projects/{projectKey}/globals/{uuid}` | `VIEWER` | `?revision=` reads the version valid at that revision (time travel) |
| `POST` | `/projects/{projectKey}/globals` | `DEVELOPER` | `{parentFolderUuid?, displayName, contentDefinition, comment?}` → `201` |
| `PUT` | `/projects/{projectKey}/globals/{uuid}/schema` | `DEVELOPER` | `{contentDefinition, comment?}`; applies `renamedFrom` and drops values of removed editors in the same revision |
| `PUT` | `/projects/{projectKey}/globals/{uuid}/content` | `EDITOR` | `{content, comment?}`; malformed values → `422` with `issues` |
| `DELETE` | `/projects/{projectKey}/globals/{uuid}` | `DEVELOPER` | refused while a template or page reads the set |

A uuid that belongs to another project or isn't a property set is `404`. CDL errors are `422` with `diagnostics` (`SF-CDL-*`, including `SF-CDL-0107` for a `body` or `catalog`).

Everything that isn't specific to property sets uses the generic endpoints: folders are `/folders` with `scope=GLOBALS`; moving a set is `POST /assets/{uuid}/move`; its uid, usages, history and restore are under `/assets/{uuid}` (§4). Validate draft CDL with `POST /cdl/validate?kind=GLOBAL_SET`, which adds the property-set restrictions.

### 6.2 Datasets and records (M19)

A **dataset** is a record schema (CDL, no bodies) in the fixed `datasets` folder of the Templates store; its **records** live in the Content store (folder scope `CONTENT`). Every single-asset response carries `ETag: "rev-{n}"`, and the `PUT`s require `If-Match`.

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/projects/{projectKey}/datasets` | `VIEWER` | summaries with `titleEditor`, `description` and live `recordCount` |
| `GET` | `/projects/{projectKey}/datasets/{uuid}` | `VIEWER` | adds `contentDefinition`, `compiledDefinition`, `deleted`; `?revision=` for time travel |
| `POST` | `/projects/{projectKey}/datasets` | `DEVELOPER` | `{parentFolderUuid?, displayName, contentDefinition, titleEditor?, description?, comment?}` → `201`; the parent defaults to `datasets` |
| `PUT` | `/projects/{projectKey}/datasets/{uuid}` | `DEVELOPER` | `{displayName?, contentDefinition, titleEditor?, description?, comment?}`; `renamedFrom` rewrites the key in every record, in the same revision |
| `DELETE` | `/projects/{projectKey}/datasets/{uuid}` | `DEVELOPER` | `409 SF-DOM-0121` with `recordCount` while it has live records, even with `?force=true` |
| `POST` | `/projects/{projectKey}/datasets/{uuid}/restore` | `DEVELOPER` | |
| `GET` | `/projects/{projectKey}/datasets/{uuid}/records` | `VIEWER` | paged listing, see below |
| `POST` | `/projects/{projectKey}/datasets/{uuid}/records` | `EDITOR` | `{folderUuid?, displayName?, content, comment?}` → `201`; `folderUuid` defaults to the Content store root; when the dataset has a `titleEditor`, that editor's value names the record and `displayName` is only the fallback while it is empty |
| `GET` | `/projects/{projectKey}/records/{uuid}` | `VIEWER` | `{uuid, uid, displayName, datasetUuid, datasetUid, folderUuid, folderPath, content, revision, changedBy, changedAt, deleted, issues}`; `?revision=` |
| `PUT` | `/projects/{projectKey}/records/{uuid}` | `EDITOR` | `{content, displayName?, comment?}`; the dataset can't change |

**Listing records.** `GET …/datasets/{uuid}/records?page=0&size=50` (size 1–500) returns `{content: [row…], page: {size, number, totalElements, totalPages}}`; a row is `{uuid, uid, displayName, folderPath, changedAt, changedBy, values}` where `values` holds only the scalar editors, for grid columns. Filters combine:

- `q` — a case-insensitive substring of the display name;
- `folder` — a Content folder path prefix, relative to the store (`/team/leads/`);
- `where` — the OCTL expression of a template's dataset loop, over **bare** field names: `role == 'lead' && joined > '2022-01-01'` (template developer guide §2.9 has the comparison rules);
- `sort` — repeatable `field` / `field,asc` / `field,desc`, including `_displayName`, `_uid`, `_folderPath` and `_changedAt`. After the given keys rows order by display name, then uid.

A malformed `where` is `400` with `column` (1-based, inside the expression); an unknown field in `where` or `sort`, a sort by a list/rich text/media/reference field, or a malformed `sort` parameter is `400` too.

**Validation.** Structural findings (wrong value shape, an option outside `options`, a `reference` with `dataset "uid"` pointing outside that dataset — code `dataset`) are `422 SF-API-0422` with `issues`. Completeness findings (`required`, `min`, …) don't block the save; they come back in the response's `issues`. A record doesn't publish anything itself, so they don't hold a page back.

Everything else is generic (§4): delete, restore, move, uid change, history and usages of a record are under `/assets/{uuid}`; a record's usages are the pages and templates that read it, a dataset's usages are the templates that loop it (not its own records). Validate draft CDL with `POST /cdl/validate?kind=DATASET`.

## 7. Media

| Method | Path |
|---|---|
| `GET`/`POST` | `/projects/{projectKey}/media` |
| `POST` | `/projects/{projectKey}/media/bulk` |
| `PUT` | `/projects/{projectKey}/media/{uuid}` |
| `POST` | `/projects/{projectKey}/media/{uuid}/replace` |
| `GET` | `/projects/{projectKey}/media/{uuid}/binary` (`?variant=`) |
| `GET` | `/projects/{projectKey}/media/{uuid}/thumbnail` |
| `GET` | `/projects/{projectKey}/media/{uuid}/share?t=` (public, token-gated; see §12) |

### 7.1 Text media and CMS processing (M18)

Text media (`text/css`, `application/javascript`, `text/javascript`, `application/json`,
`application/manifest+json`, `image/svg+xml`, `text/plain`, `application/xml`, `text/xml`) can be
edited as text and opted into CMS syntax processing (`processCms`). Media views carry `processCms`
and `textEditable`; list summaries carry both too. Other types get `400` from every endpoint below.

| Method | Path | Role | Notes |
|---|---|---|---|
| `PUT` | `/projects/{projectKey}/media/{uuid}/process` | `EDITOR` | `{processCms}`, `If-Match` required. Switching on compiles the file: errors → `422` with `diagnostics`, flag unchanged. One revision; setting the current value writes none |
| `GET` | `/projects/{projectKey}/media/{uuid}/text` | `VIEWER` | `?revision=` for time travel → `{text, mimeType, revision, utf8}` + `ETag`. `utf8: false` when the bytes aren't valid UTF-8 (decoded with replacement characters) |
| `PUT` | `/projects/{projectKey}/media/{uuid}/text` | `EDITOR` | `{text}`, `If-Match` required. One revision, new blob; MIME type, file name, metadata and `processCms` unchanged. Size cap and SVG sanitizing as on upload (`413 SF-MEDIA-0413`). A processed file compiles first (`422` with `diagnostics`). Identical content writes no revision |
| `POST` | `/projects/{projectKey}/media/{uuid}/text/validate` | `EDITOR` | `{text}` → `{diagnostics}`; nothing is saved |
| `GET` | `/projects/{projectKey}/media/{uuid}/binary?rendered=true` | `EDITOR` | processed files only (`400` otherwise); `?revision=` for time travel. The rendered output as preview serves it, `Cache-Control: no-store`; compile or render errors → `422` |

The write endpoints (`process`, `text`, `replace`) answer with `{media, warnings, processCmsCleared}`:
`warnings` are the processed source's non-blocking diagnostics (`SF-TPL-0320` for `$$`,
`SF-TPL-0321` for an unescaped value in JS/JSON), and `processCmsCleared` is `true` when a `replace`
with a non-text file switched processing off.

`GET /binary` without `rendered` always returns the stored source. The media share route
(`/share?t=`), which page previews link to, serves a processed file rendered at the token's
revision with `Cache-Control: no-store`; when the file doesn't compile or render it serves the source
with the diagnostic in `X-SF-Render-Error`.

## 8. Templates (section, page) & structures

| Method | Path |
|---|---|
| `GET`/`POST` | `/projects/{projectKey}/section-templates` |
| `GET`/`PUT`/`DELETE` | `/projects/{projectKey}/section-templates/{uuid}` |
| `GET`/`POST` | `/projects/{projectKey}/page-templates` (list items carry `abstract` and `parentTemplateRef`; create accepts `abstract`) |
| `GET`/`PUT`/`DELETE` | `/projects/{projectKey}/page-templates/{uuid}` (M20: `abstract` on read and update; read-only `parentTemplateRef`, `ancestors`, `effectiveDefinition`, `inheritedFrom`; a save returns `descendantWarnings`; `422 SF-DOM-0122` making a used template abstract, `422 SF-DOM-0124` with `descendants[]` when descendants would break) |
| `PUT`/`DELETE` | `/projects/{projectKey}/{templateKind}/{uuid}/channels/{channelKey}` |
| `GET`/`POST` | `/projects/{projectKey}/structures` |
| `GET`/`PUT`/`DELETE` | `/projects/{projectKey}/structures/{uuid}` |
| `GET` | `/projects/{projectKey}/structures/{uuid}/preview` |
| `POST` | `/projects/{projectKey}/cdl/validate` (`?kind=GLOBAL_SET` adds the property-set restrictions, `?kind=DATASET` the dataset-schema ones) |
| `POST` | `/projects/{projectKey}/octl/validate` (body `source`, `channelKey`; with `templateUuid` and optional unsaved `contentDefinition` it returns the diagnostics a save of that template's channel would: references, inheritance chain, effective-definition names) |

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
| `SF-DOM-0121` | 409 | dataset still has live records (delete, with or without `force`); the problem carries `recordCount` — `AssetServiceImpl` |
| `SF-DOM-0122` | 422 | a page template that pages use can't become abstract; carries `pageCount`, `pageUids`, `pageUuids` — `TemplateServiceImpl` |
| `SF-DOM-0123` | 422 | a page can't be created on, or switched to, an abstract page template — `PageServiceImpl` |
| `SF-DOM-0124` | 422 | a page template save would break templates that extend it; carries `descendants[]` (`uuid`, `uid`, `channel`, `diagnostics`) — `TemplateServiceImpl` |
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
| `SF-GEN-0230` | error (per file) | a processed text media file's source blob is missing; the file isn't published, run `PARTIAL` | `GenerationDiagnosticCodes` (`MediaRenderStage`) |
| `SF-GEN-0301` | warning | `raw` filter on a plain-text editor | (spec §16.3 — raised via `SF-TPL-0301` at compile time) |
| `SF-GEN-0410` | warning | navigation cycle truncated | `GenerationDiagnosticCodes` |
| `SF-GEN-0500` | 409 | a generation run is already active | `GenerationService` (`CONFLICT_CODE`) |
