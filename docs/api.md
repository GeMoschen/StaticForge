# StaticForge CMS — API reference

Human-readable summary of the REST surface. The machine-readable contract is generated from the controllers into `server/sf-app/build/openapi/openapi.json` (98 paths), and a TypeScript client is generated from it for the Angular app (§4.2, §23.1). The spec's normative endpoint catalogue is `cms-specification.md` §20; this page is a navigable index with the error codes appended.

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
| `GET` | `/projects/{key}/locales` | VIEWER |
| `PUT` | `/projects/{key}/locales` (`?confirmDiscard=`) | PROJECT_ADMIN |
| `GET` / `POST` | `/projects/{key}/export` / `/projects/{key}/export/selection` | PROJECT_ADMIN |
| `POST` | `/projects/{key}/import/analyze`, `/projects/{key}/import` (multipart `file`, `?skipExistingImplicit=`) | PROJECT_ADMIN |

**Import conflicts.** `import/analyze` returns `{conflicts: [{severity, type, elementUuid, elementLabel, detail,
explicit, blocksImport}], hasBlocking, blocksImport}` and writes nothing. `hasBlocking` is true when any conflict is
`BLOCKING`; `blocksImport` when one refuses the **whole** import. A `BLOCKING` conflict with `blocksImport: false`
rejects only its own asset, which stays out while the rest of the archive imports — today only
`RECORD_OUTSIDE_RECORD_SET` (M25: a record from before record sets, never migrated). `import` refuses exactly when
`blocksImport` is true: `409 SF-API-0409` with those conflicts under `conflicts` (each with `blocksImport`).

### 3.1 Content languages (M24)

`GET /projects/{key}/locales` returns the project's content languages; a project that declares none answers
`{"locales": [], "defaultLocale": null, "fallbacks": {}, "defaultWithoutPrefix": false}` and behaves exactly as
before M24 everywhere else.

```json
{
  "locales": [ {"code": "de", "label": "Deutsch"}, {"code": "en", "label": "English"} ],
  "defaultLocale": "de",
  "fallbacks": { "de-CH": ["de"] },
  "defaultWithoutPrefix": false
}
```

`PUT` replaces the whole configuration and allocates one `UPDATE` revision. Language tags must be well-formed
BCP 47, unique, and the default must be one of them; a fallback must name a declared language and may not be
cyclic. A violation is `400 SF-API-0400` with the findings under `errors` (`{field, message}`).

The response adds what the caller has to warn about:

| Field | Meaning |
|---|---|
| `urlsWillChange` | the edit moves every generated page (languages enabled/disabled, or the prefix setting flipped) |
| `removedLocales` | languages this edit dropped; their stored values are **kept**, not deleted |
| `retainedValueCount` | how many translations are still stored for those languages |
| `confirmationRequired` | nothing was written: the change would discard translations — re-send with `?confirmDiscard=true` |
| `discardedLocaleValues` / `affectedAssets` | how many translations, in how many assets, a confirmed change discards |

### 3.2 Translation status (M24)

| Method | Path | Role |
|---|---|---|
| `GET` | `/projects/{projectKey}/translation-status` (`?type=`, `?locale=`) | VIEWER |
| `GET` | `/projects/{projectKey}/translation-status/{uuid}` | VIEWER |

Per asset, how many language-dependent fields each language still owes: a field counts as missing when the
default language fills it and that language does not (an inherited value is *not* a translation). `?locale=en`
lists only the assets still missing an English translation — the "missing in en" filter. `orphaned` lists
languages the asset still holds values for that the project no longer declares. A project without languages
answers with an empty list.

```json
{ "assetUuid": "…", "locales": [ {"locale": "de", "missing": 0, "total": 4},
                                 {"locale": "en", "missing": 1, "total": 4} ], "orphaned": [] }
```

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

A **dataset** is a record schema (CDL, no bodies) in the fixed `datasets` folder of the Templates store; its **records** live in the Content store (folder scope `CONTENT`), always inside a **record set** of the dataset (M25, §6.3). Every single-asset response carries `ETag: "rev-{n}"`, and the `PUT`s require `If-Match`.

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/projects/{projectKey}/datasets` | `VIEWER` | summaries with `titleEditor`, `description` and live `recordCount` |
| `GET` | `/projects/{projectKey}/datasets/{uuid}` | `VIEWER` | adds `contentDefinition`, `compiledDefinition`, `channelTemplates` (record templates, `{<channel>: {source, compiledHash}}`, M25), `deleted`; `?revision=` for time travel |
| `POST` | `/projects/{projectKey}/datasets` | `DEVELOPER` | `{parentFolderUuid?, displayName, contentDefinition, titleEditor?, description?, channelTemplates?, comment?}` → `201`; the parent defaults to `datasets`. Record templates compile against the schema: an unknown channel key is `422` with `field`, compile errors `422 SF-API-0422` with `channel`, `diagnostics` and `channelDiagnostics`; warnings come back in `recordTemplateDiagnostics` |
| `PUT` | `/projects/{projectKey}/datasets/{uuid}` | `DEVELOPER` | `{displayName?, contentDefinition, titleEditor?, description?, channelTemplates?, comment?}`; `renamedFrom` rewrites the key in every record and every record set query, in the same revision (never in record templates: a template still reading the old name fails the save). Without `channelTemplates` the stored record templates are kept and recompiled. The response adds `recordTemplateDiagnostics` (warnings by channel) and `brokenRecordSets` — `[{uuid, uid, displayName, diagnostics}]`, the sets whose stored query no longer validates against the saved schema (a removed or retyped field; the save succeeds, those sets render nothing until fixed). Both are empty on reads |
| `DELETE` | `/projects/{projectKey}/datasets/{uuid}` | `DEVELOPER` | `409 SF-DOM-0121` with `recordCount`/`setCount` while it has live records or record sets, even with `?force=true` |
| `POST` | `/projects/{projectKey}/datasets/{uuid}/restore` | `DEVELOPER` | |
| `GET` | `/projects/{projectKey}/datasets/{uuid}/records` | `VIEWER` | paged listing of every record of the dataset across all of its record sets (set queries are not applied), see below |
| `POST` | `/projects/{projectKey}/datasets/{uuid}/records` | `EDITOR` | `{recordSetUuid, displayName?, content, comment?}` → `201`; the record goes into that record set, which must be a live set of this dataset (M25; otherwise `422 SF-DOM-0104`). Without `recordSetUuid` (the pre-M25 shape with `folderUuid`) it is `400 SF-API-0400` with `field: "recordSetUuid"`; when the dataset has a `titleEditor`, that editor's value names the record and `displayName` is only the fallback while it is empty |
| `GET` | `/projects/{projectKey}/records/{uuid}` | `VIEWER` | `{uuid, uid, displayName, datasetUuid, datasetUid, recordSet: {uuid, uid, displayName}, folderUuid, folderPath, content, revision, changedBy, changedAt, deleted, issues}` — `folderUuid`/`folderPath` are the record set's Content folder; `?revision=` |
| `PUT` | `/projects/{projectKey}/records/{uuid}` | `EDITOR` | `{content, displayName?, comment?}`; the dataset can't change |

**Listing records.** `GET …/datasets/{uuid}/records?page=0&size=50` (size 1–500) returns `{content: [row…], page: {size, number, totalElements, totalPages}}`; a row is `{uuid, uid, displayName, folderPath, changedAt, changedBy, values}` where `values` holds only the scalar editors, for grid columns. Filters combine:

- `q` — a case-insensitive substring of the display name;
- `folder` — a Content folder path prefix, relative to the store (`/team/leads/`);
- `where` — the OCTL expression of a template's dataset loop, over **bare** field names: `role == 'lead' && joined > '2022-01-01'` (template developer guide §2.9 has the comparison rules);
- `sort` — repeatable `field` / `field,asc` / `field,desc`, including `_displayName`, `_uid`, `_folderPath` and `_changedAt`. After the given keys rows order by display name, then uid.

A malformed `where` is `400` with `column` (1-based, inside the expression); an unknown field in `where` or `sort`, a sort by a list/rich text/media/reference field, or a malformed `sort` parameter is `400` too.

**Validation.** Structural findings (wrong value shape, an option outside `options`, a `reference` with `dataset "uid"` pointing outside that dataset — code `dataset`) are `422 SF-API-0422` with `issues`. Completeness findings (`required`, `min`, …) don't block the save; they come back in the response's `issues`. A record doesn't publish anything itself, so they don't hold a page back.

Everything else is generic (§4): delete, restore, move, uid change, history and usages of a record are under `/assets/{uuid}`; a record's usages are the pages and templates that read it, a dataset's usages are the templates that loop it (not its own records). Validate draft CDL with `POST /cdl/validate?kind=DATASET`.

### 6.3 Record sets (M25)

A **record set** (`RECORD_SET`) lives in a Content folder (or the Content store root), fixes the dataset of its records for its whole life and stores a **query** — `{where?, sort?, limit?, offset?}` — deciding which of its records are shown and in which order. `where` is an OCTL expression over bare field names (no render scope: `CMS_*`, `$CMS_SET` variables and asset references are rejected), `sort` the loop sort-key syntax (`"role,-joined"`), `limit`/`offset` non-negative integers; every part is optional and an absent part is left out of the stored and returned `query`. Sets are editor content; every single-set response carries `ETag: "rev-{n}"` and `PUT` requires `If-Match`.

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/projects/{projectKey}/record-sets` | `VIEWER` | live sets by display name, `?dataset={uuid}` for one dataset's; `[{uuid, uid, displayName, dataset: {uuid, uid, displayName}, folderUuid, folderPath, recordCount, queryValid, revision}]` |
| `GET` | `/projects/{projectKey}/record-sets/{uuid}` | `VIEWER` | adds `query`, `queryDiagnostics`, `changedBy`, `changedAt`, `deleted`; `?revision=` for time travel (the query is checked against the dataset schema of that revision); `404` for a revision before the set existed |
| `POST` | `/projects/{projectKey}/record-sets` | `EDITOR` | `{folderUuid?, datasetUuid, uid?, displayName, query?, comment?}` → `201`; no `datasetUuid` is `400` with `field`; a parent that isn't a Content folder is `422 SF-DOM-0104`; an invalid query is `422 SF-API-0422` with `diagnostics` and nothing is written |
| `PUT` | `/projects/{projectKey}/record-sets/{uuid}` | `EDITOR` | `{displayName?, query?, comment?}` — replaces the whole query (omitted: every record, default order); the dataset can't change; an invalid query is `422` with `diagnostics` |
| `DELETE` | `/projects/{projectKey}/record-sets/{uuid}` | `EDITOR` | `409 SF-DOM-0110` with `recordCount` while the set has live records; `?cascade=true` deletes the set and its records in one revision (restoring the set brings them back) |
| `GET` | `/projects/{projectKey}/record-sets/{uuid}/records` | `VIEWER` | the set's grid: the dataset listing's envelope and `q`/`where`/`sort`/`page`/`size` (same parsers, same `400`s; `folder` does not apply). `applySetQuery=true` runs the stored query first and the request narrows it: `where` is AND-ed, `sort` re-sorts (without one the set's order is kept), `q` filters last; a set whose query no longer validates lists nothing. Otherwise every record of the set is listed. `locale` picks the language values compare in (default: the project default language). Every row carries `selectedBySet`: whether the stored query selects the record, evaluated over the whole set before paging (`false` for every row while the query is invalid) — "All records" dims the rest with it; the dataset listing has no such field. `revision` lists the set as of that revision — membership, values, stored query and schema then (`404` before the set existed or while it was deleted) |
| `POST` | `/projects/{projectKey}/record-sets/{uuid}/preview-query` | `EDITOR` | body: a draft `query`; nothing is saved. `{valid, diagnostics, matchCount, selectedCount}` — `matchCount` counts the draft's `where` matches before `offset`/`limit`, `selectedCount` what the set would show (both `0` for an invalid draft) |

A query diagnostic is `{field, severity, code, message, line, column}`: `field` is the query part (`where`, `sort`, `limit`, `offset`), `line`/`column` the 1-based position inside that part's text (`0` when unknown, and for `limit`/`offset`), `code` is `SF-TPL-0140` (malformed, or reads the render scope), `SF-TPL-0141` (a field the dataset doesn't declare) or `SF-TPL-0142` (a sort field without a natural order).

Records are added with `POST /datasets/{uuid}/records` and `recordSetUuid` (§6.2). Move, display-name and uid change, generic delete, restore, history and usages of a set are under `/assets/{uuid}` (§4), with the containment rules: a set moves only into a Content folder (or the root), a record only into a live set of its own dataset — anything else is `422 SF-DOM-0104`. Moving a set moves its records' `folderPath` with it. The Content folder tree (`GET /folders?scope=CONTENT`) lists sets as leaves with `type: "RECORD_SET"` and `recordCount`.

## 7. Media

| Method | Path |
|---|---|
| `GET`/`POST` | `/projects/{projectKey}/media` |
| `POST` | `/projects/{projectKey}/media/bulk` |
| `PUT` | `/projects/{projectKey}/media/{uuid}` (`?locale=`) |
| `POST` | `/projects/{projectKey}/media/{uuid}/replace` |
| `GET` | `/projects/{projectKey}/media/{uuid}/binary` (`?variant=`) |
| `GET` | `/projects/{projectKey}/media/{uuid}/thumbnail` |
| `GET` | `/projects/{projectKey}/media/{uuid}/share?t=` (public, token-gated; see §12) |

### 7.1 Text media and CMS processing (M18)

Text media (every `text/*` type, every `+json`/`+xml` type such as `image/svg+xml` or
`application/manifest+json`, and `application/javascript`, `application/json`, `application/xml`,
`application/yaml`) can be edited as text and opted into CMS syntax processing (`processCms`). Media views carry `processCms`
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
| `GET`/`POST` | `/projects/{projectKey}/page-templates` (list items carry `abstract` and `parentTemplateRef`; create accepts `abstract` and `paginationPath`, a channel → pattern map for pages 2..N of a paginated page that must contain `{pageNumber}`) |
| `GET`/`PUT`/`DELETE` | `/projects/{projectKey}/page-templates/{uuid}` (M20: `abstract` on read and update; read-only `parentTemplateRef`, `ancestors`, `effectiveDefinition`, `inheritedFrom`; a save returns `descendantWarnings`; `422 SF-DOM-0122` making a used template abstract, `422 SF-DOM-0124` with `descendants[]` when descendants would break) |
| `PUT`/`DELETE` | `/projects/{projectKey}/{templateKind}/{uuid}/channels/{channelKey}` |
| `GET`/`POST` | `/projects/{projectKey}/structures` |
| `GET`/`PUT`/`DELETE` | `/projects/{projectKey}/structures/{uuid}` |
| `GET` | `/projects/{projectKey}/structures/{uuid}/preview` |
| `POST` | `/projects/{projectKey}/cdl/validate` (`?kind=GLOBAL_SET` adds the property-set restrictions, `?kind=DATASET` the dataset-schema ones) |
| `POST` | `/projects/{projectKey}/octl/validate` (body `source`, `channelKey`; with `templateUuid` and optional unsaved `contentDefinition` it returns the diagnostics a save of that template's channel would: references, inheritance chain, effective-definition names; with `datasetUuid` (M25) and optional unsaved dataset `contentDefinition` it checks the source as that dataset's record template — record fields and meta names in scope, so an undeclared field is `SF-TPL-0103` and `$CMS_BODY`/`$CMS_EXTENDS`/`$CMS_BLOCK`/`$CMS_PARENT` are `SF-TPL-0122`, as on save. `templateUuid` with `datasetUuid` is `422`; an unknown dataset `404`) |

**Language-dependent editors (M24).** A CDL leaf editor may be `localizable`; a container (`group`, `list`,
`catalog`, `pagination`) may not (`SF-CDL-0112`). Adding the flag migrates every stored value of that editor into
the `{"type":"L10N","values":{…}}` wrapper, in the **same** revision as the template save. Removing it reduces each
value to the default language, so the save is refused with `409 SF-API-0409` carrying `discardedLocaleValues`,
`discardedLocales` and `affectedAssets`, and **nothing is written**; re-send with `?confirmDiscard=true` to go
ahead. `PUT /globals/{uuid}/schema` and `PUT /datasets/{uuid}` take the same flag for the same reason.

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
| `POST` | `/projects/{projectKey}/generations/plan` (`DEVELOPER`; `?page=&size=&rootKind=&channel=&q=&validate=`) |
| `GET` | `/projects/{projectKey}/generations/{runId}/plan` (`VIEWER`; `?page=&size=&rootKind=&channel=&q=`) |
| `GET` | `/projects/{projectKey}/assets/{uuid}/impact` (`VIEWER`; `?channel=&page=&size=&q=`) |

A run view carries `planSummary` (`null` for a run that never got past PLAN): `{mode, incremental, revision, fallbackCause, baselineRevision, baseRunId, scoped, channels, changedAssetCount, entryCount, pageCount, processedMediaCount, byRootKind, byFirstEdge, byChannel, via: [{edge, assetUuid, assetType, uid, count}], planAvailable}`.

**Build insight (M22).** `POST /generations/plan` takes the body of `POST /generations` and returns the plan a run started now would build — same snapshot, baseline and planner — without rendering, writing, storing a run or taking the run lock (it works while a run is active). `GET /generations/{runId}/plan` returns what a past run planned; `404` for a run of another project or one that never got past PLAN. Both answer `GenerationPlanView`:

```json
{ "runId": null, "target": {"id": 3, "name": "Site"},
  "summary": { "incremental": true, "baselineRevision": 1840, "entryCount": 3, "…": "…" },
  "changedAssets": [ {"uuid": "…", "type": "SECTION_TEMPLATE", "uid": "teaser", "deleted": false, "revision": 1842} ],
  "entries": { "content": [ {
      "assetUuid": "…", "assetType": "PAGE", "uid": "about", "displayName": "About", "channel": "html",
      "outputPath": "about.html", "pageNumber": null,
      "reason": { "rootKind": "ASSET_CHANGED", "rootAsset": {"uuid": "…", "type": "SECTION_TEMPLATE", "uid": "teaser"},
                  "rootRevision": 1842, "causeCount": 1, "fallbackCause": null,
                  "steps": [ {"assetUuid": "…", "assetType": "PAGE", "uid": "about", "edge": "SECTION_TEMPLATE",
                              "referenceKind": null, "sourcePath": "bodies.main[0].templateRef"} ] } } ],
    "page": {"size": 50, "number": 0, "totalElements": 3, "totalPages": 1} },
  "diagnostics": null }
```

`steps` run from the planned asset towards the root and exclude it; each step says how its asset depends on the next (`PAGE_TEMPLATE`, `SECTION_TEMPLATE`, `PARENT_TEMPLATE`, `REFERENCE` with `referenceKind`, `NAVIGATION`, `DATASET_MEMBERSHIP`, `PAGINATION_SOURCE`, and for record sets `RECORD_SET_MEMBERSHIP` — the reader's set may select the changed record, `sourcePath` is the set's uid —, `RECORD_SET_QUERY` — the set's stored query changed — and `RECORD_TEMPLATE` — the reader renders a set's records through the dataset's record template, `sourcePath` is the set's uid). Root kinds are `FULL_BUILD`, `INCREMENTAL_FALLBACK_FULL`, `EXPLICIT_SCOPE`, `ASSET_CHANGED`, `ASSET_DELETED`, `NOT_IN_BASE_BUILD`; clients must tolerate names added later. `validate=true` adds `diagnostics` (the VALIDATE findings grouped by code, like a run's). A pruned stored plan has `summary.planAvailable: false` and `entries: null`. Entries of processed media re-rendered by an incremental plan have `channel: null`. `size` is 1–500 (`400` otherwise).

`GET /assets/{uuid}/impact` answers what would rebuild if the asset changed, with the planner's own walk over the current state: `{asset: {uuid, type, uid}, revision, entryCount, pageCount, byFirstEdge, entries}` (entries as above, root = the asset, `rootRevision` null). It is an upper bound — every loop over a record's dataset, a page change counted as navigation-affecting — so a real edit rebuilds the same entries or fewer. `404` for an unknown or deleted asset.

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
| `GET` | `/projects/{projectKey}/preview/pages/{uuid}` (`?revision=`, `?channel=`, `?page=`, `?locale=`) — page preview by identity; the server resolves content/bodies/meta from the database, the client never sends rendered data. `page` (M21) renders that page of a paginated page, clamped to its page count; the response carries `X-SF-Total-Pages` and `X-SF-Page`. `locale` (M24) renders one content language; without it, the project's default |
| `POST` | `/projects/{projectKey}/preview/section` |
| `GET` | `/projects/{projectKey}/preview/pages/{uuid}/share` (`?locale=`, issue a share link; the language is bound into the token) |
| `GET` | `/projects/{projectKey}/preview/share` (`?t=`, render via a share token; `?page=` as above, not part of the token — the language is) |
| `GET` | `/projects/{projectKey}/pagination/count` (`?kind=NAV\|DATASET&source=uuid`) — M21: `{itemCount, skipped}` of a pagination source now, counted like generation does; `404` when the source isn't a live Navigation folder or dataset, `422` for another `kind` |

## 13. Search (M23)

Editorial full-text search over a project's **current** assets, answered from an embedded per-project index that is
kept up to date after each commit (see [architecture §12](architecture.md#12-search)). Time travel doesn't change
what search returns.

| Method | Path | Role |
|---|---|---|
| `GET` | `/projects/{projectKey}/search` | VIEWER |
| `GET` | `/projects/{projectKey}/search/status` | VIEWER |
| `POST` | `/projects/{projectKey}/search/reindex` | PROJECT_ADMIN |

`GET /search?q=&type=&folder=&page=0&size=20&sort=relevance&locale=`:

- `q` is required, 1–200 characters after trimming. It is never parsed as query syntax: words are matched in any of the
  analyzed fields (German and English stemming, umlaut folding), `"quoted words"` as a phrase, the last word also as a
  prefix while typing, the whole input as an exact uid or uid prefix. When nothing matches, words of five or more
  letters also match with one typo.
- `type` is repeatable (`type=PAGE&type=MEDIA`), `folder` a folder path prefix (`/pages_root/news/`), `size` 1–100,
  `sort` only `relevance`, and a page may reach at most 10,000 hits. Anything else is `400 SF-SEARCH-0400`.
- `locale` (M24) searches one content language: text of a language-dependent value is indexed into that language's
  field, so `locale=de` stems German and does not match a value that exists only in English. Without it every
  language is searched, which is what a project without languages always does.

```json
{ "content": [
    { "uuid": "…", "type": "PAGE", "uid": "harbour_notes", "displayName": "Harbour notes",
      "folderPath": "/pages_root/", "templateUuid": "…", "score": 3.2, "matchedIn": "CONTENT",
      "snippet": "Seen near the pier: a quokka.", "highlights": [ {"start": 22, "end": 28} ] } ],
  "page": {"size": 20, "number": 0, "totalElements": 2, "totalPages": 1, "totalIsLowerBound": false},
  "facets": {"types": {"MEDIA": 1, "PAGE": 1}},
  "indexedRevision": 42, "latestRevision": 42 }
```

`matchedIn` is where the best match is: `UID`, `TITLE` (display name and uid), `CONTENT` (values, alt text, labels) or
`SOURCE` (CDL, OCTL, processed text files). `snippet` is plain text, never HTML; `highlights` are `[start, end)` offsets
into it. `facets.types` counts hits with every filter but `type` applied, so the counts of unselected types stay
visible. `indexedRevision`/`latestRevision` show how current the answer is; `indexedRevision` is `null` while the
project has no usable index yet.

`GET /search/status` → `{indexedRevision, latestRevision, lag, state, lastRebuildAt}`, `state` one of `READY`,
`CATCHING_UP` (behind the latest revision), `REBUILDING` (a full rebuild is queued or running; queries answer from the
previous index until it is swapped in) and `UNAVAILABLE` (this instance can't open the index; search answers `503`).

`POST /search/reindex` starts a full rebuild and returns `202` with the status (`REBUILDING`); `409 SF-SEARCH-0409`
while one is queued or running, `503` when the index is unavailable.

## 14. System

| Method | Path |
|---|---|
| `GET` | `/api/v1/status` (liveness/readiness; in addition to `/actuator/health`) |

## 15. Error catalogue

Codes from `cms-specification.md` Appendix B, annotated with where they are raised in code. `ProblemFactory` (in `sf-common`) constructs the `problem+json` bodies.

### API (`SF-API-*`)

| Code | HTTP | Raised by / notes |
|---|---|---|
| `SF-API-0400` | 400 | malformed request body — `ProblemFactory`; a missing required member is named in `field` (M25: `recordSetUuid` on record create, `datasetUuid` on record set create); invalid channel output settings carry a `fieldErrors` array of `{field, message}` — `ChannelServiceImpl` |
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
| `SF-DOM-0104` | 422 | record set containment violated (M25): a record outside a live record set of its dataset, a record set outside a Content folder, or anything but a record in a set — on create, move, restore — `RecordSetContainment` |
| `SF-DOM-0110` | 409 | folder not empty — `FolderService`; a record set with live records (delete without `cascade`) carries `recordCount` (M25) |
| `SF-DOM-0120` | 409 | asset still referenced by an open edge from a non-deleted asset (delete without `force`) — `AssetServiceImpl` |
| `SF-DOM-0121` | 409 | dataset still has live records or live record sets (delete, with or without `force`); the problem carries `recordCount` and `setCount` (M25) — `AssetServiceImpl` |
| `SF-DOM-0122` | 422 | a page template that pages use can't become abstract; carries `pageCount`, `pageUids`, `pageUuids` — `TemplateServiceImpl` |
| `SF-DOM-0123` | 422 | a page can't be created on, or switched to, an abstract page template — `PageServiceImpl` |
| `SF-DOM-0124` | 422 | a page template save would break templates that extend it; carries `descendants[]` (`uuid`, `uid`, `channel`, `diagnostics`) — `TemplateServiceImpl` |
| `SF-DOM-0130` | 422 | page reference folder target has no page in its subtree — `PageReferenceServiceImpl` (a section template outside a body's `allow` list is `SF-API-0422` with an `allow` issue) |
| `SF-DOM-0140` | 409 | project key already exists — *implemented addition* |

### Template (`SF-TPL-*`, `SF-CDL-*`)

Defined in `template.diagnostic.DiagnosticCodes` (see [template-developer guide](template-developer-guide.md) for the full table):

- OCTL (`SF-TPL-01xx` / `02xx` / `03xx`) — compile errors and warnings per §16.11.
- CDL (`SF-CDL-01xx` / `02xx`) — CDL compile/validation errors; these are not enumerated in the spec but are stable, machine-readable codes.

### Search (`SF-SEARCH-*`)

| Code | HTTP | Raised by |
|---|---|---|
| `SF-SEARCH-0400` | 400 | invalid search parameters (`q`, `type`, `size`, `page`, `sort`) — `SearchService` |
| `SF-SEARCH-0409` | 409 | a rebuild is already queued or running — `SearchService.reindex` |
| `SF-SEARCH-0503` | 503 | the project's index can't be opened (write lock held by another instance) — `SearchIndexServiceImpl` |

### Generation (`SF-GEN-*`)

Defined across `generate.GenerationDiagnosticCodes` and `generate.GenerationService` (build-time, no HTTP status unless noted):

| Code | Severity | Meaning | Raised by |
|---|---|---|---|
| `SF-GEN-0110` | error | output path collision | `RenderPipeline` (`COLLISION_CODE`) |
| `SF-GEN-0111` | error | a page's output path has no `{locale}` segment in a project with several content languages, so two languages would write the same file (M24) | `RenderPipeline` (`NOT_LOCALE_DISTINCT_CODE`) |
| `SF-GEN-0120` | error (per page) | content incomplete; page held back, run `PARTIAL` | `GenerationDiagnosticCodes` (`RenderPipeline.incompletePages`) |
| `SF-GEN-0210` | warning | no channel template for enabled channel | `GenerationDiagnosticCodes` |
| `SF-GEN-0220` | warning | reference to a deleted asset (`$CMS_REF`, `$CMS_INCLUDE`, body section); renders empty | `GenerationRenderer` |
| `SF-GEN-0230` | error (per file) | a processed text media file's source blob is missing; the file isn't published, run `PARTIAL` | `GenerationDiagnosticCodes` (`MediaRenderStage`) |
| `SF-GEN-0240` | warning | a record set's stored query no longer validates against its dataset (a field it reads was removed or retyped); the set renders no records, never all of them (M25) | `DiagnosticCodes.GEN_RECORD_SET_QUERY_INVALID` (`RecordSetQueries.invalidQueryWarning`) |
| `SF-GEN-0241` | warning | a record set rendered as a value has no record template for the channel in its dataset; the set renders empty (M25) | `DiagnosticCodes.GEN_RECORD_TEMPLATE_MISSING` (`OctlRenderer`) |
| `SF-GEN-0301` | warning | `raw` filter on a plain-text editor | (spec §16.3 — raised via `SF-TPL-0301` at compile time) |
| `SF-GEN-0410` | warning | navigation cycle truncated | `GenerationDiagnosticCodes` |
| `SF-GEN-0500` | 409 | a generation run is already active | `GenerationService` (`CONFLICT_CODE`) |
