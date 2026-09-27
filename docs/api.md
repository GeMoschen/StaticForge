# StaticForge CMS — API reference

Human-readable summary of the REST surface. The machine-readable contract is generated from the controllers into `server/sf-app/build/openapi/openapi.json` (139 paths as of M28), and a TypeScript client is generated from it for the Angular app (§4.2, §23.1). The spec's normative endpoint catalogue is `cms-specification.md` §20; this page is a navigable index with the error codes appended.

## 1. Conventions

- Base path `/api/v1`, JSON except media upload/download.
- Errors are RFC 9457 `application/problem+json` with a `code` extension (see section 5).
- Pagination `?page=0&size=50&sort=displayName,asc`; envelope `{ "content": [...], "page": {...} }`.
- Concurrency via `ETag`/`If-Match` (`"rev-{validFromRevision}"`); idempotency via `Idempotency-Key` (24 h) on `POST` creates.

## 2. Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/auth/login` | username+password → access token + refresh cookie; a `Bearer` header is ignored |
| `POST` | `/api/v1/auth/refresh` | rotates refresh, returns access token; a `Bearer` header is ignored (a revoked one can't block its replacement) |
| `POST` | `/api/v1/auth/logout` | revokes refresh family |
| `GET` | `/api/v1/auth/me` | `id, username, displayName, email, systemRole, mustChangePassword, projectRoles, memberships[{projectKey, projectName, role}]` |
| `PATCH` | `/api/v1/auth/me` | own profile `{displayName?, username?, email?, currentPassword?}`; username/email need `currentPassword` — M26 |
| `POST` | `/api/v1/auth/password` | change own password (policy applies); revokes every session, this one included |
| `POST` | `/api/v1/auth/sessions/revoke` | sign out everywhere, this session included — M26 |
| `GET` | `/api/v1/auth/password-policy` | public `{minLength, requireMixed, maxBytes}` — M26 |

While `mustChangePassword` is set, every other authenticated call answers `428 SF-API-0428` (spec §8.2). Membership,
role and status changes revoke access tokens at once through the token epoch (spec §9.2): the next call is `401`, and a
refresh returns a token with the current roles.

## 3. Projects & membership

| Method | Path | Role |
|---|---|---|
| `GET` | `/projects` | authenticated (member projects only; archived projects only for INSTANCE_ADMIN) |
| `POST` | `/projects` | INSTANCE_ADMIN |
| `GET`/`PUT` | `/projects/{key}` | VIEWER / PROJECT_ADMIN — the detail carries `publishPolicy` and the caller's `permissions` (M28, §3.3) |
| `POST` | `/projects/{key}/archive` | INSTANCE_ADMIN — read-only (`409 SF-DOM-0141` on every write) and `404` for members until unarchived |
| `POST` | `/projects/{key}/unarchive` | INSTANCE_ADMIN |
| `GET` | `/projects/{key}/members` | VIEWER — `email` only for PROJECT_ADMIN and instance admins, `status` per member |
| `PUT`/`DELETE` | `/projects/{key}/members/{userId}` | PROJECT_ADMIN — `PUT {role}` adds or changes; a disabled/deleted account is `409` |
| `GET` | `/projects/{key}/audit` | PROJECT_ADMIN — the project's audit entries, newest first |
| `GET`/`PUT` | `/projects/{key}/publish-policy` | VIEWER / PROJECT_ADMIN — what editors may publish (M28, §3.3) |
| `POST` | `/projects/{key}/publish-policy/impact` | PROJECT_ADMIN — the schedules a proposed policy would make fail (M28, §3.3) |
| `GET` | `/users/lookup?projectKey=&q=` | PROJECT_ADMIN of `projectKey` — up to 20 active/locked accounts `{id, username, displayName, member}`, no emails (M26) |
| `GET` | `/projects/{key}/locales` | VIEWER |
| `PUT` | `/projects/{key}/locales` (`?confirmDiscard=`) | PROJECT_ADMIN |
| `GET` / `POST` | `/projects/{key}/export` / `/projects/{key}/export/selection` | PROJECT_ADMIN |
| `POST` | `/projects/{key}/import/analyze`, `/projects/{key}/import` (multipart `file`, `?skipExistingImplicit=`, `?releaseMode=KEEP\|DRAFT` — M27, `?importSchedules=` — M27.8, default `true`) | PROJECT_ADMIN |

**Import conflicts.** `import/analyze` returns `{conflicts: [{severity, type, elementUuid, elementLabel, detail,
explicit, blocksImport}], hasBlocking, blocksImport}` and writes nothing. `hasBlocking` is true when any conflict is
`BLOCKING`; `blocksImport` when one refuses the **whole** import. A `BLOCKING` conflict with `blocksImport: false`
rejects only its own asset, which stays out while the rest of the archive imports — today only
`RECORD_OUTSIDE_RECORD_SET` (M25: a record from before record sets, never migrated). `import` refuses exactly when
`blocksImport` is true: `409 SF-API-0409` with those conflicts under `conflicts` (each with `blocksImport`).

**Release state (M27, protocol 8).** The analysis also answers `releaseState` (the archive carries release state) and
`releaseMode` (the mode that applies: `DRAFT` for an archive without release state). `releaseMode=KEEP` (default)
restores the archive's statuses; `DRAFT` imports everything as draft and leaves deletion-pending assets out. A kept
release for a language the target doesn't have is the warning `RELEASE_LOCALE_MISSING`; a protocol ≤ 7 archive lists
the `INFO` entry `ARCHIVE_WITHOUT_RELEASE_STATE` (severity `INFO` neither blocks nor warns). The import result counts
the opened release pointers in `releasedCount`.

**Schedules (M27.8, protocol 9).** `POST …/export/selection` takes `includeSchedules` (default `false`; on its own it
is a valid selection): the open schedules, a release or unpublish only when all its assets are selected. The full
export always carries them. The analysis answers `scheduleCount` (the archive's schedules, whether or not they are
imported) and, with `importSchedules=true`, the warnings `DUPLICATE_SCHEDULE` (replaces the open schedule with the same
`uuid`; one that executes or has finished is left alone), `SCHEDULE_OVERDUE`, `SCHEDULE_TARGET_MISSING`,
`SCHEDULE_INVALID` (with the `SF-DOM` code) and `SCHEDULE_OWNER_REPLACED` — each with the schedule's `uuid` as
`elementUuid`. None blocks the import. The import result adds `importedScheduleCount`, `updatedScheduleCount` and
`scheduleWarnings` (what happened at commit time, in the conflict shape). Schedules and generation targets expose their
`uuid`.

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

### 3.3 Publish policy and publish permissions (M28)

What a project's editors may do to put content online (spec §8.3). Four permissions, all off by default:
`RELEASE` (release, discard, unpublish), `SCHEDULE_RELEASE` (one-off scheduled releases and unpublishing; needs
`RELEASE`), `INCREMENTAL_BUILD` (incremental runs to the default target, optionally scoped), `FULL_BUILD` (full runs,
any target; needs `INCREMENTAL_BUILD`). Viewers never hold one; developers, project admins and instance admins always
hold all four.

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/projects/{projectKey}/publish-policy` | VIEWER | `{editor: [...]}` in declaration order |
| `PUT` | `/projects/{projectKey}/publish-policy` | PROJECT_ADMIN | body `{editor: [...]}` → the stored policy |
| `POST` | `/projects/{projectKey}/publish-policy/impact` | PROJECT_ADMIN | body = the proposed policy; stores nothing, also on archived projects |

```http
PUT /api/v1/projects/acme/publish-policy
{ "editor": ["RELEASE", "INCREMENTAL_BUILD"] }
```

A policy that names an unknown permission or breaks an implication is `400 SF-API-0400` with one message per problem:

```json
{ "code": "SF-API-0400", "detail": "The publish policy is invalid.",
  "errors": [ "SCHEDULE_RELEASE requires RELEASE: editors who schedule a release must be allowed to release.",
              "FULL_BUILD requires INCREMENTAL_BUILD: editors who start full builds must be allowed to start incremental ones." ] }
```

An identical policy answers `200` and records nothing; a change allocates one `UPDATE` revision (summary entry
`PROJECT`, field `publishPolicy`) and the audit entry `PUBLISH_POLICY_SET` (`{before, after}`). The policy is read on
every check, so it applies to every editor's **next request** — no token refresh. `409 SF-DOM-0141` on an archived
project.

`impact` lists the pending schedules whose owner satisfies them now but wouldn't under the proposal — the ones that
would fail at execution:

```json
{ "failingSchedules": [ { "id": 12, "type": "RELEASE", "runAt": "2026-09-29T07:00:00Z", "ownerUserId": 7,
                          "ownerName": "Bob Editor", "missingPermission": "SCHEDULE_RELEASE" } ] }
```

`runAt` is the next run time. **`GET /projects/{key}`** adds `publishPolicy` (`{editor}`, readable by every member)
and `permissions`, the caller's effective publish permissions in declaration order — clients show publishing controls
from `permissions`, never from the role.

**Denials.** Every `403` of a publishing endpoint (releases, schedules, generation, targets, publish policy) is
`SF-API-0403` with the extension `permission`: the missing publish permission, or `ROLE:<role>` for a rule no policy
opens. A client that gets one should re-read the project detail — the policy may have changed while it was open.

```json
{ "status": 403, "code": "SF-API-0403", "permission": "RELEASE",
  "detail": "You need the RELEASE permission for this; the project's publish policy decides which editors hold it." }
```

**Request rules for editors.**

| Operation | Editor needs |
|---|---|
| `POST /releases`, `/releases/unpublish`, `/releases/discard` | `RELEASE` |
| `POST /generations`, `POST /generations/plan` with `mode: INCREMENTAL` (explicit), no `targetId` or the default target's, no `revision`; `folderPath`/`assetUuids` allowed | `INCREMENTAL_BUILD` |
| the same with `mode: FULL`, without `mode`, or to another target | `FULL_BUILD` |
| any `revision` | never (`ROLE:DEVELOPER`) |
| `POST /generations/{id}/cancel` | `INCREMENTAL_BUILD`, and they started the run (a scheduled run: the schedule's owner did) — else `ROLE:DEVELOPER` |
| `POST /generations/{id}/promote`, `POST /targets` | never (`ROLE:DEVELOPER`) |
| `PUT`/`DELETE /targets/{id}`, `PUT /publish-policy`, `POST /publish-policy/impact` | never (`ROLE:PROJECT_ADMIN`) |
| schedules `RELEASE`/`UNPUBLISH`: create, edit, run now, re-pin and cancel their own; take over | `SCHEDULE_RELEASE`, plus `INCREMENTAL_BUILD` for a "then generate" to the default target or `FULL_BUILD` to another |
| schedules `GENERATION`/`RECURRING_GENERATION`; changing someone else's schedule | never (`ROLE:DEVELOPER`) |

An incremental request that the planner turns into a full build (`fallbackCause`) is allowed with `INCREMENTAL_BUILD`.
A `VIEWER` is refused every publishing operation (`ROLE:EDITOR` on generation, the missing permission elsewhere).

### 3.4 Revision compaction (M29)

Opt-in per project, `PROJECT_ADMIN` for all three (spec §7.7). Compaction removes old versions for good; the
`revision-compaction` system job (§14.2) runs it weekly for every non-archived project with an enabled policy.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/projects/{projectKey}/compaction` | the policy |
| `PUT` | `/projects/{projectKey}/compaction` (`?confirm=<projectKey>`) | body `{enabled, olderThanDays?}` → the policy |
| `GET` | `/projects/{projectKey}/compaction/estimate?olderThanDays=N` | dry run; allowed on archived projects |

```json
{ "enabled": true, "olderThanDays": 90, "enabledAt": "2026-09-27T08:12:00Z", "enabledBy": 7,
  "compactedThrough": 1840,
  "lastRun": { "runId": 311, "finishedAt": "2026-09-27T03:00:41Z", "dryRun": false, "outcome": "SUCCEEDED",
               "cutoff": "2026-06-29T03:00:00Z", "error": null, "versionsInWindow": 5120, "assetsTouched": 212,
               "versionsRemoved": 3877, "referencesRewritten": 940, "revisionsMarked": 1502, "bytesFreed": 18233411 } }
```

- `olderThanDays` is at least 30 (`422 SF-DOM-0183`, checked first). Omitted, it keeps the current value (90 for a
  project that never set one).
- **Enabling**, or lowering `olderThanDays` while enabled, needs `confirm` equal to the project key (`422 SF-DOM-0182`).
  Disabling (stored as `{enabled: false, olderThanDays, enabledAt: null, enabledBy: null}`) and raising need nothing;
  raising keeps `enabledAt`/`enabledBy`.
- A change is audited `COMPACTION_POLICY_SET` (before/after) and records **no revision**; an unchanged policy records
  nothing. An archived project refuses it (`409 SF-DOM-0141`).
- `lastRun` is this project's entry of the newest of the job's last 50 runs that reported on it (`null` otherwise);
  `runId` is a `system_job_run` id (`/admin/jobs/revision-compaction/runs/{runId}`, instance admins).
- The **estimate** runs the compaction as a dry run with the cutoff "now − N days" and answers
  `{olderThanDays, cutoff, versionsInWindow, versionsRemoved, assetsTouched, referencesRewritten, revisionsMarked,
  bytesFreed}` (`bytesFreed` = serialized payload size of the removed versions; blob bytes are freed later by
  `blob-sweep`). `N` below 30 is `422 SF-DOM-0183`.
- The policy is not part of project exports; an imported project starts with compaction off.

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

**Release blocks (M27).** Every view of a releasable asset — pages, records, record sets, global sets, media, page
references and editorial folders, with their list rows, tree nodes and `GET /assets/{uuid}` — carries
`release: {localeKey: {status, releasedRevision, releasedAt, releasedBy}}` (key `""` = every language; `null` for
templates, store roots and past versions) and `scheduled: [{actionId, type, locale, runAt, nextRunAt, ownerUserId}]`,
the pending schedules touching it. `status` is `NEW`, `PUBLISHED`, `CHANGED`, `UNPUBLISHED` or `DELETION_PENDING`
(spec §5.5). Deleting an asset that is released somewhere writes a tombstone that stays online (`DELETION_PENDING`)
until the deletion is released.

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

Every node of the folder tree (and of `GET /navigation/tree`) carries its current `revision`, the `If-Match` a rename from the tree sends back.

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
| `POST` | `/projects/{projectKey}/datasets/{uuid}/records` | `EDITOR` | `{recordSetUuid, content, comment?}` → `201`; the record goes into that record set, which must be a live set of this dataset (M25; otherwise `422 SF-DOM-0104`). Without `recordSetUuid` (the pre-M25 shape with `folderUuid`) it is `400 SF-API-0400` with `field: "recordSetUuid"`. A record is never named by hand: its `uid` is its uuid in uid form (`3f2a9c1e_8b7d_…`), and its `displayName` is the dataset's `titleEditor` value, else the uuid |
| `GET` | `/projects/{projectKey}/records/{uuid}` | `VIEWER` | `{uuid, uid, displayName, datasetUuid, datasetUid, recordSet: {uuid, uid, displayName}, folderUuid, folderPath, content, revision, changedBy, changedAt, deleted, issues}` — `folderUuid`/`folderPath` are the record set's Content folder; `?revision=` |
| `PUT` | `/projects/{projectKey}/records/{uuid}` | `EDITOR` | `{content, comment?}`; the dataset can't change. The display name follows the `titleEditor` value when it is set and stays as it is otherwise. The generic `PATCH /assets/{uuid}/display-name` and `/uid` refuse a record with `422 SF-DOM-0105`; a `displayName` sent here or on create is ignored |

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
| `GET` | `/projects/{projectKey}/media/{uuid}` (`?revision=`) — one media view with `localeFiles` (M27) |
| `GET` | `/projects/{projectKey}/media/{uuid}/binary` (`?variant=`, `?locale=`) |
| `GET` | `/projects/{projectKey}/media/{uuid}/thumbnail` (`?locale=`) |
| `PUT` | `/projects/{projectKey}/media/{uuid}/localized` — see §7.2 |
| `POST`/`DELETE` | `/projects/{projectKey}/media/{uuid}/files/{locale}` — see §7.2 |
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

### 7.2 Localized media (M27)

In a project with languages a media asset can hold one file per language (spec §11.6). The media view answers
`localized` and, for every project language, the file it renders:

```json
{ "uuid": "…", "uid": "hero", "localized": true, "fileName": "hero.png", "revision": 57,
  "localeFiles": {
    "de": { "own": true,  "fromLocale": "de", "fileName": "hero.png",    "mimeType": "image/png", "sizeBytes": 483920, "image": {"width": 2400, "height": 1350} },
    "en": { "own": true,  "fromLocale": "en", "fileName": "hero-en.png", "mimeType": "image/png", "sizeBytes": 471002, "image": {"width": 2400, "height": 1350} },
    "fr": { "own": false, "fromLocale": "de", "fileName": "hero.png",    "mimeType": "image/png", "sizeBytes": 483920, "image": {"width": 2400, "height": 1350} } },
  "release": { "de": {"status": "PUBLISHED", "…": "…"}, "en": {"status": "CHANGED", "…": "…"}, "fr": {"status": "PUBLISHED", "…": "…"} } }
```

List rows carry `localized` only; `GET /media/{uuid}` returns the whole view (with `ETag`).

| Method | Path | Role | Notes |
|---|---|---|---|
| `PUT` | `/projects/{projectKey}/media/{uuid}/localized` | `EDITOR` | `{localized, confirmDiscard?}`, `If-Match` required; one revision. Localizing makes the current file the default language's. Un-localizing keeps the default language's file; while other languages have their own, it answers `409 SF-MEDIA-0505` with `files: [{locale, fileName, sizeBytes}]` until repeated with `confirmDiscard: true`. `422 SF-MEDIA-0508` in a project without languages |
| `POST` | `/projects/{projectKey}/media/{uuid}/files/{locale}` | `EDITOR` | multipart `file`; uploads or replaces that language's own file with the upload rules (sniffing, allow-list, size cap, SVG sanitizing) → `{media, warnings, processCmsCleared}`. `422 SF-MEDIA-0506` for media that isn't localized, `0507` for a language the project doesn't have |
| `DELETE` | `/projects/{projectKey}/media/{uuid}/files/{locale}` | `EDITOR` | the language falls back again; `422 SF-MEDIA-0509` for the default language's file; a language without its own file changes nothing |

`?locale=` on `binary`, `thumbnail`, `text` (`GET`/`PUT`), `process` and the rendered binary addresses the file that
language renders; a text write for a language that falls back gives it its own file.

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
| `GET`/`POST` | `/projects/{projectKey}/targets` (read VIEWER, create DEVELOPER) |
| `PUT`/`DELETE` | `/projects/{projectKey}/targets/{id}` (PROJECT_ADMIN) |

## 10. Generation

| Method | Path |
|---|---|
| `GET`/`POST` | `/projects/{projectKey}/generations` (history `VIEWER`; start `EDITOR`, then the body decides — §3.3) |
| `GET` | `/projects/{projectKey}/generations/{runId}` |
| `GET` | `/projects/{projectKey}/generations/{runId}/events` (SSE) |
| `POST` | `/projects/{projectKey}/generations/{runId}/cancel` (`DEVELOPER`; an editor with `INCREMENTAL_BUILD` their own run) |
| `POST` | `/projects/{projectKey}/generations/{runId}/promote` (`DEVELOPER`) |
| `POST` | `/projects/{projectKey}/generations/plan` (authorized like a start; `?page=&size=&rootKind=&channel=&q=&validate=`) |
| `GET` | `/projects/{projectKey}/generations/{runId}/plan` (`VIEWER`; `?page=&size=&rootKind=&channel=&q=`) |
| `GET` | `/projects/{projectKey}/assets/{uuid}/impact` (`VIEWER`; `?channel=&page=&size=&q=`) |

A run view carries `comment` — the note it was started with (`POST /generations` `comment`, trimmed; a longer one is cut to 500 characters ending in "…"; a scheduled run's is `Scheduled generation #n: …` or `After scheduled release|unpublish #n`), `null` for none —, `startedBy` — `{id, displayName}` of who started it (the schedule's owner for a scheduled run; `displayName` "Deleted user" once that account was deleted), `null` when unknown (M28) — and `planSummary` (`null` for a run that never got past PLAN): `{mode, incremental, revision, fallbackCause, baselineRevision, baseRunId, scoped, channels, changedAssetCount, entryCount, pageCount, processedMediaCount, byRootKind, byFirstEdge, byChannel, via: [{edge, assetUuid, assetType, uid, count}], planAvailable}`.

**Who may start what (M28).** Start and dry run check the body against the caller's publish permissions (§3.3):
`INCREMENTAL_BUILD` for an explicit incremental run to the default target, `FULL_BUILD` otherwise, `DEVELOPER` for a
pinned `revision`. Start, cancel and promote are audited (`GENERATION_STARTED`, `GENERATION_CANCELLED`,
`GENERATION_PROMOTED`). An `Idempotency-Key` is scoped by project and user: another user reusing a key starts their own
run.

**Cancel, interrupted runs, promote and retention (M29).**

- `cancel` is real: the run stops before its next page or stage and **never publishes** once `CANCELLED` is committed;
  SSE subscribers get a final `REPORT` event with the terminal status. Cancelling a run that already finished changes
  nothing.
- A run left `QUEUED`/`RUNNING` by a node that died or restarted is failed by the `generation-run-recovery` job (at
  startup and every 5 minutes) with the diagnostic `SF-GEN-0504` "Run interrupted (node restart or lost heartbeat)"
  (`errorCount` 1); a new `POST /generations` then starts normally instead of answering `409 SF-GEN-0500`.
- `promote` of a run that isn't `SUCCESS`/`PARTIAL`, has no target, or whose build is no longer on disk is
  `409 SF-GEN-0505`; `current` stays. Rollback points (`sf.generate.keep-builds`) count published builds only.
- Idempotency keys are remembered for `sf.generate.idempotency-ttl` (24 h); a re-submission after that starts a new
  run.
- Old runs are deleted by `generation-run-retention` (spec §18.5): run ids may have gaps, `GET /generations/{id}` and
  `/plan` of a deleted run are `404`, and a schedule execution whose run was deleted answers `generationRunId: null`
  (the id stays in its `detail.deletedGenerationRunId`).

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

### 10.1 Schedules (M27)

Scheduled releases, unpublishing and builds (spec §18.7). Every endpoint needs `VIEWER`; every change checks what the
action requires of the caller — M28: `SCHEDULE_RELEASE` (plus the build permission of a "then generate") for
`RELEASE`/`UNPUBLISH`, `DEVELOPER` for `GENERATION`/`RECURRING_GENERATION`; editing, running now, re-pinning or
cancelling someone else's schedule needs `DEVELOPER` on top, taking over only the requirements (§3.3). A refusal is
`403 SF-API-0403` with `permission`. Times are ISO instants; a recurring
schedule's cron is evaluated in its `zoneId`. Single-schedule responses carry `ETag: "v{version}"`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/projects/{projectKey}/schedules` | `type`, `status` (repeatable), `owner` (user id), `assetUuid`, `from`/`to` (on `nextRunAt`, `[from, to)`), `page`, `size` ≤ 200 → `{rows, page, size, totalElements, totalPages}`; next due first; rows carry `itemCount`, `driftCount` and `lastExecution`, not `items` |
| `POST` | `/projects/{projectKey}/schedules` | creates; the answer is the detail |
| `GET` | `/projects/{projectKey}/schedules/{id}` | detail with `items` |
| `PUT` | `/projects/{projectKey}/schedules/{id}` | `If-Match: "v{n}"` (`409 SF-API-0409` stale, `412` missing); `PENDING` only; omitted `params` keep the stored ones; the type can't change |
| `POST` | `/projects/{projectKey}/schedules/{id}/cancel` | a pending or paused schedule |
| `POST` | `/projects/{projectKey}/schedules/{id}/take-over` | the caller becomes the owner; a paused recurring schedule resumes at its next slot, a failed one-off is due at its original time |
| `POST` | `/projects/{projectKey}/schedules/{id}/run-now` | a pending schedule runs on the next poll (a recurring one keeps its cron) |
| `POST` | `/projects/{projectKey}/schedules/{id}/repin` | pins a pending `PINNED` release to the current drafts (`422 SF-DOM-0168` otherwise) |
| `GET` | `/projects/{projectKey}/schedules/{id}/executions` | newest first, `page`/`size` |
| `POST` | `/projects/{projectKey}/schedules/preview-times` | `{cron, zoneId, count?}` (default 5) → `{cron, zoneId, times}`; the cron normalized to 6 fields; validated like a create (`422 SF-DOM-0165`) |

A scheduled release of two languages of a page, pinned, with an incremental build right after:

```http
POST /api/v1/projects/acme/schedules
{ "type": "RELEASE", "runAt": "2026-09-29T07:00:00Z",
  "pinPolicy": "PINNED", "missedPolicy": "SKIP_IF_LATER_THAN", "maxLateness": "PT2H",
  "thenGenerate": { "targetId": 3, "channels": [] },
  "params": { "items": [ {"assetUuid": "0190…", "locale": "de"}, {"assetUuid": "0190…", "locale": "en"} ],
              "includeDependencies": [ {"assetUuid": "0191…"} ], "comment": "Autumn campaign" } }
```

```json
{ "id": 12, "type": "RELEASE", "status": "PENDING", "runAt": "2026-09-29T07:00:00Z", "nextRunAt": "2026-09-29T07:00:00Z",
  "pinPolicy": "PINNED", "missedPolicy": "SKIP_IF_LATER_THAN", "maxLateness": "PT2H",
  "thenGenerate": { "targetId": 3, "channels": [] },
  "params": { "resolved": true, "comment": "Autumn campaign",
              "items": [ {"assetUuid": "0190…", "locale": "de", "pinnedVersionId": 5812}, "…" ] },
  "ownerUserId": 7, "createdBy": 7, "version": 0, "itemCount": 3, "driftCount": 0,
  "items": [ { "assetUuid": "0190…", "assetType": "PAGE", "uid": "autumn", "displayName": "Autumn", "locale": "de",
               "pinnedVersionId": 5812, "draftChangedSinceScheduled": false, "status": "CHANGED" }, "…" ],
  "lastExecution": null }
```

The other types, `runAt` for one-off and `cron` + `zoneId` for recurring:

```json
{ "type": "UNPUBLISH", "runAt": "2026-10-31T23:00:00Z", "params": { "items": [ {"assetUuid": "0190…"} ] } }
{ "type": "GENERATION", "runAt": "2026-09-29T02:00:00Z",
  "params": { "mode": "FULL", "channels": ["html"], "targetId": 3, "scope": {"folderPath": "/products/"} } }
{ "type": "RECURRING_GENERATION", "cron": "0 3 * * 1-5", "zoneId": "Europe/Berlin",
  "params": { "mode": "INCREMENTAL", "channels": [], "targetId": null } }
```

`missedPolicy` is `RUN_LATE` (default) or `SKIP_IF_LATER_THAN` with `maxLateness` as an ISO-8601 duration. Errors:
`422 SF-DOM-0160` unknown type, `0161` params that don't fit (`field` names the offender), `0164` `runAt` in the past,
`0165` invalid cron or zone, `0166` a timing form that doesn't fit the type, the release codes (`SF-DOM-0150` a pinned
version is incomplete, `0151`, `0153`), `409 SF-DOM-0167` while the schedule executes, `409 SF-DOM-0141` in an
archived project.

An execution is `{id, scheduledFor, startedAt, finishedAt, outcome, lateByMs, message, detail, revisionId,
generationRunId, executedAsUserId}`, `outcome` one of `SUCCEEDED`, `PARTIAL`, `FAILED`, `SKIPPED` (`null` while it
runs). For releases `detail.items` lists `{assetUuid, locale, result: APPLIED|UNCHANGED|SKIPPED, reason?}`;
`detail.waitingForRun` names the run a busy project waits for; a failure carries `detail.code` (`SF-DOM-0162` target
gone, `0163` owner no longer permitted — the schedule is paused until taken over; the message names what is missing,
e.g. "Owner no longer permitted (SCHEDULE_RELEASE): 'bob' is EDITOR without SCHEDULE_RELEASE in the project's
publish policy.").

## 11. Revisions & restore

| Method | Path |
|---|---|
| `GET` | `/projects/{projectKey}/revisions` (`?since=`, `?userId=`, `?assetUuid=`) |
| `GET` | `/projects/{projectKey}/revisions/{revisionId}` |
| `GET` | `/projects/{projectKey}/revisions/{revisionId}/diff` |
| `POST` | `/projects/{projectKey}/restore` (project-wide rollback) |

**Compacted history (M29, spec §7.7).** In a project that uses revision compaction, some old versions were removed
and their intervals absorbed by the last version of the day. Reads say so; projects without compaction get
`compacted: false` (and no header) everywhere.

- Revision views (list, detail, and the project restore response) carry `compacted`; `GET /projects/{key}` carries
  `compactedThrough` (`null` = never compacted).
- `GET /assets/{uuid}/versions/{revision}` and `POST /assets/{uuid}/restore` carry `compacted: true` when the version
  served (or restored) absorbed that revision: it shows a later, end-of-day state.
- The typed time-travel reads (`?revision=` on media, property sets, datasets, records, record sets and the record-set
  grid), `POST /projects/{key}/restore` and the draft preview at a revision answer the header `X-SF-Compacted: true`
  instead (absent otherwise). The preview checks only the page itself; a published preview is never compacted.
- `GET /revisions/{r}/diff` carries `compacted` and `message` (`"Exact changes of this revision were compacted; the
  state at the end of the day is kept"`, `null` otherwise); an asset whose change was absorbed has `compacted: true`,
  `changes: []` and the summary's `action`, the others diff normally.

### 11.1 Release, unpublish, discard and Changes (M27)

Saving writes a draft; a release makes the draft of chosen languages the version builds render (spec §5.5). Each
action is one revision (`RELEASE`, `UNPUBLISH`, `DISCARD`) and starts no build. Request body of all four:
`{items: [{assetUuid, locale?}], includeDependencies?: [{assetUuid, locale?}], comment?}` — an item without `locale`
means every language the asset has.

| Method | Path | Role | Notes |
|---|---|---|---|
| `POST` | `/projects/{projectKey}/releases/plan` | `VIEWER` | dry run, also on archived projects |
| `POST` | `/projects/{projectKey}/releases` | `RELEASE` | releases `items` and the kept `includeDependencies` |
| `POST` | `/projects/{projectKey}/releases/unpublish` | `RELEASE` | takes the items offline; drafts stay |
| `POST` | `/projects/{projectKey}/releases/discard` | `RELEASE` | writes the released versions back as drafts |
| `GET` | `/projects/{projectKey}/changes` | `VIEWER` | every (asset, locale) that isn't `PUBLISHED` |
| `GET` | `/projects/{projectKey}/changes/count` | `VIEWER` | `{NEW, CHANGED, UNPUBLISHED, DELETION_PENDING, total}` |
| `GET` | `/projects/{projectKey}/changes/{uuid}/diff` | `VIEWER` | `?locale=` (omitted: the shared key) |

Plan, then release:

```http
POST /api/v1/projects/acme/releases/plan
{ "items": [ {"assetUuid": "0190…", "locale": "en"} ] }
```

```json
{ "items": [ {"uuid": "0190…", "type": "PAGE", "uid": "about", "displayName": "About", "locale": "en", "status": "CHANGED", "versionId": 5812} ],
  "dependencies": [
    { "target": {"uuid": "0191…", "type": "MEDIA", "uid": "hero", "displayName": "Hero", "locale": "en", "status": "NEW", "versionId": 5790},
      "reason": "REFERENCE", "via": "0190…", "includedByDefault": true } ],
  "incomplete": [],
  "warnings": [] }
```

`reason` is `REFERENCE` (the selection's drafts reference it), `CONTAINER` (an unreleased folder or record set the
selection sits in), `SET_MEMBER` (an unreleased record of a selected set) or `DESCENDANT` (a changed descendant of a
selected changed folder, `includedByDefault: false`). `incomplete` lists items with blocking completeness findings
(`{uuid, locale, issues}`); releasing them is refused.

```http
POST /api/v1/projects/acme/releases
{ "items": [ {"assetUuid": "0190…", "locale": "en"} ],
  "includeDependencies": [ {"assetUuid": "0191…", "locale": "en"} ], "comment": "About page, English" }
```

```json
{ "revision": 1902,
  "applied": [ {"uuid": "0190…", "type": "PAGE", "uid": "about", "locale": "en", "status": "PUBLISHED", "versionId": 5812, "…": "…"},
               {"uuid": "0191…", "type": "MEDIA", "uid": "hero", "locale": "en", "status": "PUBLISHED", "versionId": 5790, "…": "…"} ],
  "skipped": [], "sharedFieldsKept": [] }
```

`revision` is `null` when every item was already live (nothing is written); `skipped` lists those. A discard lists in
`sharedFieldsKept` the items whose shared (not per-language) fields stayed, because other languages have unreleased
changes on them. Errors: `422 SF-DOM-0150` content incomplete (`assets[]` with the findings), `0151` unknown asset or
language or a live type (templates have no release state), `0152` discard of something never released (`assets[]`),
`0153` empty selection; `403 SF-API-0403` with `permission: "RELEASE"` without the publish permission (developers
always hold it, editors when the policy opens it, M28); `409 SF-DOM-0141` in an archived project.

`GET /changes?type=PAGE&status=CHANGED&locale=en&sort=changedAt,desc&page=0&size=50` (filters `type`, `status`,
`locale` repeat; also `changedBy`, `folderUuid` — the folder's subtree — and `q` on display name or uid;
`sort=changedAt|displayName` with `,asc|,desc`; `size` 1–200):

```json
{ "rows": [ { "uuid": "0190…", "type": "PAGE", "uid": "about", "displayName": "About", "folderPath": "/pages_root/company/",
              "locale": "en", "status": "CHANGED", "changedBy": 7, "changedAt": "2026-09-26T08:12:00Z",
              "releasedRevision": 1840, "releasedBy": 7, "releasedAt": "2026-09-20T10:00:00Z", "scheduled": [] } ],
  "page": 0, "size": 50, "totalElements": 1, "totalPages": 1 }
```

`folderPath` is the stored path (with the store root). `GET /changes/{uuid}/diff?locale=en` →
`{uuid, locale, status, changes: [{path, before, after, blocks, add, remove}]}`, released → draft over the locale
projection (`path` like `payload.content.headline`).

## 12. Preview

| Method | Path |
|---|---|
| `GET` | `/projects/{projectKey}/preview/pages/{uuid}` (`?revision=`, `?channel=`, `?page=`, `?locale=`) — page preview by identity; the server resolves content/bodies/meta from the database, the client never sends rendered data. `page` (M21) renders that page of a paginated page, clamped to its page count; the response carries `X-SF-Total-Pages` and `X-SF-Page`. `locale` (M24) renders one content language; without it, the project's default. `view=draft` (default) or `published` (M27): the draft renders the page's draft and the drafts of everything it reads, `published` what the next build publishes; `X-SF-View` names the view, a draft preview carries `X-SF-Release-Status` (the page's status in the language), a page not released in the language is `404 SF-DOM-0155` in the published view, anything but `draft`/`published` is `400` |
| `POST` | `/projects/{projectKey}/preview/section` |
| `GET` | `/projects/{projectKey}/preview/pages/{uuid}/share` (`?locale=`, `?view=`, issue a share link; the language and the view are bound into the token) |
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

`GET /search?q=&type=&folder=&page=0&size=20&sort=relevance&locale=&releaseStatus=` (`releaseStatus`, M27: repeatable or
comma-separated `NEW`, `PUBLISHED`, `CHANGED`, `UNPUBLISHED`, `DELETION_PENDING` — keeps assets with that status in any
language; search itself indexes drafts):

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

### 14.1 Instance administration (M26)

All `INSTANCE_ADMIN` only (`403` otherwise).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/admin/users` (`?q=&status=&systemRole=&includeDeleted=&page=&size=&sort=`) | paged accounts (`size` ≤ 200, default sort `username`), deleted ones only on request |
| `GET` | `/api/v1/admin/users/{id}` | detail incl. `createdAt, failedLogins, lockedUntil, memberships` |
| `POST` | `/api/v1/admin/users` | create `{username, email, displayName?, systemRole, password? \| generatePassword, mustChangePassword = true, memberships?}` → `201`; `generatedPassword` only in this response |
| `PATCH` | `/api/v1/admin/users/{id}` | `{username?, email?, displayName?}`; duplicates `409` with `field` |
| `POST` | `/api/v1/admin/users/{id}/disable`, `/enable`, `/unlock`, `/revoke-sessions` | disable and revoke-sessions end every session |
| `POST` | `/api/v1/admin/users/{id}/password` | reset `{password? \| generatePassword, mustChangePassword = true}`; ends every session |
| `PUT` | `/api/v1/admin/users/{id}/system-role` | `{systemRole}`; ends every session |
| `DELETE` | `/api/v1/admin/users/{id}?confirm=<username>` | anonymizing delete (spec §8.2) |
| `GET` | `/api/v1/admin/projects` (`?q=&includeArchived=true`) | every project sorted by key: `key, name, description, archived, createdAt, memberCount, headRevision, lastChangeAt`; `q` matches key, name, description ignoring case |
| `GET` | `/api/v1/admin/audit` (`?action=&action=&userId=&project=&from=&to=&page=&size=`) | every audit entry, newest first (paged, `size` ≤ 200, `sort` ignored); `project` is a key or `_instance` (entries without a project); `from` inclusive, `to` exclusive ISO instants; row `id, timestamp, action, actor{id, username}, projectKey, target, detail` — a deleted actor reads `Deleted user` |
| `GET` | `/api/v1/admin/audit/actions` | the distinct action names, alphabetically |

### 14.2 System jobs (M29)

Instance-level background jobs (spec §26.6), `INSTANCE_ADMIN` only. Operator guide: [administration guide,
Housekeeping jobs](administration.md#housekeeping-jobs-m29).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/admin/jobs` | every job by key (a plain array), orphaned ones included |
| `GET` | `/api/v1/admin/jobs/{key}` | one job, `ETag: "v{version}"` |
| `GET` | `/api/v1/admin/jobs/{key}/runs` (`?page=&size=`) | history, newest first, `{content, page}`; `size` ≤ 200 (default 20), `sort` ignored |
| `GET` | `/api/v1/admin/jobs/{key}/runs/{runId}` | one run with its full `report` |
| `PATCH` | `/api/v1/admin/jobs/{key}` | `{enabled?, cron?, zone?, settings?}`, `If-Match: "v{n}"` |
| `POST` | `/api/v1/admin/jobs/{key}/reset` | back to the `sf.housekeeping.*` defaults |
| `POST` | `/api/v1/admin/jobs/{key}/run` (`?dryRun=true\|false`) | `202` with the run and a `Location` to it |

```json
{ "key": "blob-sweep", "name": "Blob sweep", "description": "Deletes stored media bytes that no version …",
  "enabled": true, "cron": "30 3 * * *", "zone": "UTC", "settings": {"graceHours": 24, "batchSize": 1000},
  "defaults": {"enabled": true, "cron": "30 3 * * *", "zone": "UTC", "settings": {"graceHours": 24, "batchSize": 1000}},
  "nextRunAt": "2026-09-28T03:30:00Z", "running": false, "startedAt": null, "currentRunId": null, "progress": null,
  "supportsDryRun": true, "orphaned": false, "version": 3, "updatedAt": "2026-09-27T09:02:11Z",
  "lastRun": { "id": 412, "outcome": "SUCCEEDED", "trigger": "SCHEDULE", "dryRun": false,
               "startedAt": "2026-09-27T03:30:00Z", "finishedAt": "2026-09-27T03:30:07Z", "durationMs": 7012,
               "itemsExamined": 18344, "itemsAffected": 12, "bytesFreed": 48122880, "message": null } }
```

- A run: `{id, jobKey, trigger (SCHEDULE|MANUAL|STARTUP), dryRun, startedAt, finishedAt, durationMs, outcome
  (SUCCEEDED|FAILED|PARTIAL|SKIPPED; null while running), itemsExamined, itemsAffected, bytesFreed, message,
  startedBy {id, username} (null for the system), sample (at most 50 items), sampleTotal, report}`; `report` (the
  job's structured counts, e.g. `byAction` for `audit-purge` or `projects[]` for `revision-compaction`) only on
  `GET …/runs/{runId}`. While a job runs, the job view has `running: true`, `startedAt`, `currentRunId` and a
  `progress` line.
- `settings` are typed per job (camelCase keys, durations as strings, ISO-8601 such as `PT1H` or `30m`/`24h` style; stored defaults read like `PT1H`); `PATCH` merges them into the stored
  settings. Unknown keys, out-of-range values, an invalid cron or zone are one `422 SF-DOM-0180` with
  an `errors` list (one message per problem, e.g. `Setting 'graceHours' must be a whole number from 1 to 8760.`). A missing
  `If-Match` is `412 SF-API-0412`, a stale one `409 SF-API-0409`. A change recomputes `nextRunAt` and is audited
  `JOB_SETTINGS_SET` (target `job:<key>`, before/after); a `PATCH` that changes nothing isn't audited and keeps the
  version. `reset` is audited the same way.
- `run` answers `202`; poll `GET …/runs/{id}` until `finishedAt` is set. `409 SF-DOM-0181` while the job runs on any
  node (a scheduled run claiming the same lease included), `422 SF-DOM-0180` for `dryRun=true` on a job without dry
  run. Audited `JOB_RUN` (detail `dryRun`). Manual runs don't move `nextRunAt`.
- An unknown key is `404 SF-DOM-0184`. An *orphaned* job (its row remains, its code was removed) is listed and
  readable, but `PATCH`, `reset` and `run` answer `404 SF-DOM-0184`.

| Key | Default cron (UTC) | Settings (defaults) | Dry run |
|---|---|---|---|
| `generation-run-recovery` | startup + `*/5 * * * *` | `staleAfter` (`PT5M`, ≥ 1 min) | — |
| `build-output-cleanup` | `10 3 * * *` | `minAge` (`PT1H`) | ✅ |
| `blob-sweep` | `30 3 * * *` | `graceHours` (24, 1–8760), `batchSize` (1000) | ✅ |
| `audit-purge` | `0 4 * * *` | `retentionDays` (365, 30–36500), `batchSize` (5000) | ✅ |
| `refresh-token-cleanup` | `15 * * * *` | `reuseWindow` (`PT168H` = 7 days, ≤ 365 days) | — |
| `memory-eviction` | `*/10 * * * *` | — | — |
| `generation-run-retention` | `15 4 * * *` | `keepDays` (90), `keepPerProject` (50) | ✅ |
| `media-variant-backfill` | `0 2 * * *` | `maxPerRun` (500), `includeHistorical` (false) | — |
| `search-maintenance` | `0 5 * * *` | `mergeDeletesPct` (20, 1–100) | — |
| `revision-compaction` | `0 3 * * 0` | `batchAssets` (200, 1–10000) | ✅ |

## 15. Error catalogue

Codes from `cms-specification.md` Appendix B, annotated with where they are raised in code. `ProblemFactory` (in `sf-common`) constructs the `problem+json` bodies.

### API (`SF-API-*`)

| Code | HTTP | Raised by / notes |
|---|---|---|
| `SF-API-0400` | 400 | malformed request body — `ProblemFactory`; a missing required member is named in `field` (M25: `recordSetUuid` on record create, `datasetUuid` on record set create); invalid channel output settings carry a `fieldErrors` array of `{field, message}` — `ChannelServiceImpl` |
| `SF-API-0401` | 401 | missing/expired access token — `ProblemEntryPoint` |
| `SF-API-0403` | 403 | role insufficient — `ProjectAuthorizationService`; publishing handlers add `permission` (a publish permission or `ROLE:<role>`, M28) — `ProjectAuthorizationService.can`/`satisfies`, `ActionAuthority`, `PolicyReleasePermissionCheck` |
| `SF-API-0404` | 404 | not found / not visible (does not leak existence, §8.4) |
| `SF-API-0409` | 409 | revision conflict (`If-Match` mismatch), §7.5; a stale schedule version or an edit racing a scheduler claim (M27) — `ProblemExceptionHandler` |
| `SF-API-0412` | 412 | `If-Match` missing on a mutating request |
| `SF-API-0413` | 413 | upload exceeds configured limit (§11.5) |
| `SF-API-0415` | 415 | MIME type not allowed (Tika sniff, §11.4) |
| `SF-API-0422` | 422 | CDL validation failed (field-level details); structural page content findings on save carry an `issues` array — `PageContentValidation` |
| `SF-API-0423` | 423 | account locked (login lockout, §9.5) — *implemented addition* |
| `SF-API-0428` | 428 | password change required (forced change pending, spec §8.2) — `PasswordChangeRequiredFilter` |
| `SF-API-0429` | 429 | rate limit exceeded (login) |
| `SF-API-0500` | 500 | internal error — *implemented addition* |

### Domain (`SF-DOM-*`)

| Code | HTTP | Raised by |
|---|---|---|
| `SF-DOM-0101` | 422 | UID already taken (probe exhaustion) — `UidGenerator` |
| `SF-DOM-0102` | 422 | reserved UID — `UidGenerator` |
| `SF-DOM-0103` | 422 | folder depth limit exceeded — `PathService.MAX_DEPTH` — *implemented addition* |
| `SF-DOM-0104` | 422 | record set containment violated (M25): a record outside a live record set of its dataset, a record set outside a Content folder, or anything but a record in a set — on create, move, restore — `RecordSetContainment` |
| `SF-DOM-0105` | 422 | a record's uid and display name are derived and can't be set or changed (M25) — `RecordNaming` |
| `SF-DOM-0110` | 409 | folder not empty — `FolderService`; a record set with live records (delete without `cascade`) carries `recordCount` (M25) |
| `SF-DOM-0120` | 409 | asset still referenced by an open edge from a non-deleted asset (delete without `force`) — `AssetServiceImpl` |
| `SF-DOM-0121` | 409 | dataset still has live records or live record sets (delete, with or without `force`); the problem carries `recordCount` and `setCount` (M25) — `AssetServiceImpl` |
| `SF-DOM-0122` | 422 | a page template that pages use can't become abstract; carries `pageCount`, `pageUids`, `pageUuids` — `TemplateServiceImpl` |
| `SF-DOM-0123` | 422 | a page can't be created on, or switched to, an abstract page template — `PageServiceImpl` |
| `SF-DOM-0124` | 422 | a page template save would break templates that extend it; carries `descendants[]` (`uuid`, `uid`, `channel`, `diagnostics`) — `TemplateServiceImpl` |
| `SF-DOM-0130` | 422 | page reference folder target has no page in its subtree — `PageReferenceServiceImpl` (a section template outside a body's `allow` list is `SF-API-0422` with an `allow` issue) |
| `SF-DOM-0131` | 409 | the last active instance admin can't be disabled, deleted or demoted — `UserAdministrationService` |
| `SF-DOM-0132` | 409 | an admin can't disable, delete or demote themselves — `UserAdministrationService` |
| `SF-DOM-0140` | 409 | project key already exists — *implemented addition* |
| `SF-DOM-0141` | 409 | project is archived: every write is refused (M26) — `ArchivedProjectInterceptor`, `RevisionService.allocate`, `ProjectWriteGuard` |
| `SF-DOM-0150` | 422 | content incomplete: releasing (or pinning a scheduled release of) content with `ERROR` completeness findings; `assets[]` with the findings (M27) — `ReleaseProblems`, `ReleaseServiceImpl`, `ReleaseActionHandler` |
| `SF-DOM-0151` | 422 | release item can't be resolved: unknown asset, a language the asset doesn't have, or a live type (M27) — `ReleaseServiceImpl` |
| `SF-DOM-0152` | 422 | discard of something never released; `assets[]` (M27) — `ReleaseServiceImpl.discard` |
| `SF-DOM-0153` | 422 | empty release selection (M27) — `ReleaseServiceImpl` |
| `SF-DOM-0154` | 422 | a pinned version that isn't the asset's, or is a deletion (M27) — `ReleaseServiceImpl` |
| `SF-DOM-0155` | 404 | published preview of a page not released in the language (M27) — `ReleaseProblems.notPublished` |
| `SF-DOM-0160` | 422 | unknown schedule type; also a paused execution's `detail.code` (M27) — `SchedulerProblems` |
| `SF-DOM-0161` | 422 | schedule params don't fit the type, `field` names the offender; also an execution failure when a channel was disabled since (M27) — handlers' `validate` |
| `SF-DOM-0162` | — | execution failure: the generation target is gone; a recurring schedule pauses (M27) — `ScheduledGenerations` |
| `SF-DOM-0163` | — | execution failure: the owner is no longer permitted (M28: also an editor the publish policy no longer allows; the message names the missing permission); a recurring schedule pauses until taken over (M27) — `SchedulerEngine` |
| `SF-DOM-0164` | 422 | schedule time in the past (M27) — `ScheduleService` |
| `SF-DOM-0165` | 422 | invalid cron or unknown/missing time zone (M27) — `ScheduleTiming` |
| `SF-DOM-0166` | 422 | a timing form that doesn't fit the type (M27) — `ScheduleService` |
| `SF-DOM-0167` | 409 | the schedule is executing or waits for a busy project (M27) — `ScheduleService` |
| `SF-DOM-0168` | 422 | re-pin of anything but a pending pinned release (M27) — `ReleaseActionHandler.repin` (the SPI default refuses too) |
| `SF-DOM-0180` | 422 | invalid system-job cron, zone or settings, or a dry run of a job without one; `errors` lists every problem (M29) — `HousekeepingProblems`, `SystemJobService` |
| `SF-DOM-0181` | 409 | the system job is already running, on any node (M29) — `SystemJobService.runNow` |
| `SF-DOM-0182` | 422 | enabling compaction, or lowering `olderThanDays`, without `confirm` = the project key (M29) — `CompactionPolicyService` |
| `SF-DOM-0183` | 422 | compaction `olderThanDays` below 30 (policy and estimate) (M29) — `CompactionPolicyService` |
| `SF-DOM-0184` | 404 | unknown system job, or an orphaned one on edit, reset or run (M29) — `SystemJobService` |

### Media (`SF-MEDIA-*`, localized media)

| Code | HTTP | Raised by |
|---|---|---|
| `SF-MEDIA-0505` | 409 | un-localizing would discard other languages' files; `files[]`; repeat with `confirmDiscard` (M27) — `MediaProblems` |
| `SF-MEDIA-0506` | 422 | per-language file operation on media that isn't localized (M27) |
| `SF-MEDIA-0507` | 422 | a language the project doesn't declare (M27) |
| `SF-MEDIA-0508` | 422 | localizing media in a project without languages (M27) |
| `SF-MEDIA-0509` | 422 | removing the default language's file (M27) |

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
| `SF-GEN-0221` | warning | link (`$CMS_REF`, `media`/`link` value) to an asset not released in the render language; renders empty (M27; a cross-asset value of it is `SF-TPL-0112`) | `GenerationRenderer` (`GEN_UNRELEASED_REFERENCE`) |
| `SF-GEN-0230` | error (per file) | a processed text media file's source blob is missing; the file isn't published, run `PARTIAL` | `GenerationDiagnosticCodes` (`MediaRenderStage`) |
| `SF-GEN-0240` | warning | a record set's stored query no longer validates against its dataset (a field it reads was removed or retyped); the set renders no records, never all of them (M25) | `DiagnosticCodes.GEN_RECORD_SET_QUERY_INVALID` (`RecordSetQueries.invalidQueryWarning`) |
| `SF-GEN-0241` | warning | a record set rendered as a value has no record template for the channel in its dataset; the set renders empty (M25) | `DiagnosticCodes.GEN_RECORD_TEMPLATE_MISSING` (`OctlRenderer`) |
| `SF-GEN-0301` | warning | `raw` filter on a plain-text editor | (spec §16.3 — raised via `SF-TPL-0301` at compile time) |
| `SF-GEN-0410` | warning | navigation cycle truncated | `GenerationDiagnosticCodes` |
| `SF-GEN-0500` | 409 | a generation run is already active | `GenerationService` (`CONFLICT_CODE`) |
| `SF-GEN-0501` | error | unexpected failure of a run; run `FAILED` | `GenerationService` (`UNEXPECTED_CODE`) |
| `SF-GEN-0502` | 422 | generation target not found, or no target configured | `GenerationService` (`NO_TARGET_CODE`) |
| `SF-GEN-0503` | 500 | a stored run's channels can't be decoded | `GenerationController` |
| `SF-GEN-0504` | error | run interrupted (node restart or lost heartbeat); run `FAILED` by recovery (M29) | `GenerationService` (`INTERRUPTED_CODE`, `GenerationRunRecoveryJob`) |
| `SF-GEN-0505` | 409 | promote of a run that isn't `SUCCESS`/`PARTIAL`, has no target, or whose build is gone; `current` unchanged (M29) | `GenerationService` (`NOT_PROMOTABLE_CODE`) |
