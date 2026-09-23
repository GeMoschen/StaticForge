---
id: M25.3.1
status: done
depends: [M25.1.1, M25.1.2, M25.2.1]
epic: m25-record-sets
feature: api
area: backend
---

# M25.3.1 — `RecordSetController`, record create by set, dataset record templates in DTOs

## Context

`M19.2.1` added `DatasetController` and `RecordController` (`EDITOR` writes, `VIEWER` reads, `ETag` =
revision, `If-Match` for updates, `?revision=` for time travel) with DTOs in `api/dto`
(`CreateRecordRequest`, `RecordPageView`, `RecordRowView`, …). Record listing takes `q`, `folder`,
`where`, `sort`, `page`, `size`.

## Goals

- `RecordSetController` under `/projects/{p}/record-sets`:
  - `GET ?dataset=` — list (uid, displayName, dataset {uuid, uid, displayName}, folderPath, recordCount,
    queryValid);
  - `POST` — create (`folderUuid`, `datasetUuid`, `uid?`, `displayName`, `query`, `comment`);
  - `GET /{uuid}?revision=` — detail incl. query and `queryDiagnostics`;
  - `PUT /{uuid}` (`If-Match`) — displayName + query; `422` with diagnostics on an invalid query;
  - `DELETE /{uuid}?cascade=` — `409` + `recordCount` without cascade on a non-empty set;
  - `GET /{uuid}/records?q=&where=&sort=&page=&size=&applySetQuery=` — the set's records; with
    `applySetQuery=true` the stored query is applied first and request `where`/`sort` narrow it
    (decision 5), otherwise the grid sees every record of the set.
  - `POST /{uuid}/preview-query` — validate a draft query and return `{diagnostics, matchCount}` without
    saving (for the query editor's live feedback).
- `RecordController`: `CreateRecordRequest` takes `recordSetUuid` (drop `datasetUuid`/`folderUuid`);
  `RecordDetailView` gains `recordSet {uuid, uid, displayName}`. Keep `GET /datasets/{uuid}/records` working
  (all records of a dataset across sets, `folder` still accepted) — the `dataset:` loop mental model.
- `DatasetDetailView` / `Create|UpdateDatasetRequest` carry `channelTemplates`; dataset update response
  carries `brokenRecordSets` (`M25.1.2`) and compile diagnostics per channel.
- Move/uid-change/delete/restore/usages/history stay on the generic asset endpoints; verify they accept
  `RECORD_SET` and return the containment error shape for invalid moves.
- Regenerate OpenAPI and `ui/src/app/api/schema.d.ts`; update `docs/api.md`.

## Acceptance criteria

- [x] MockMvc/integration tests per endpoint incl. role checks (VIEWER cannot write, EDITOR can), `ETag`/
      `If-Match` conflict, time-travel `?revision=`, `422` diagnostics for a bad query, `409` delete.
- [x] `applySetQuery=true` + request `where` returns the intersection, ordered by request `sort` when given.
- [x] Creating a record with the old request shape fails with `400` naming `recordSetUuid`.
- [x] `schema.d.ts` regenerated and the UI still compiles (type errors fixed in `M25.5.*`, but the build must
      not be left broken — stub-adjust call sites if needed).

## Out of scope

- UI (`M25.5.*`).

## Notes / hazards

- Keep `where`/`sort` parameter semantics byte-for-byte those of the `M19` record listing — one parser.

## Implementation notes (2026-09-23)

- **`RecordSetController`** (`/api/v1/projects/{p}/record-sets`, sf-api) — a thin mapping onto `RecordSetService`:
  `GET ?dataset=` (list), `POST` (create, `201` + `ETag`), `GET /{uuid}?revision=`, `PUT /{uuid}` (`If-Match`;
  no header `412`, stale `409 SF-API-0409`), `DELETE /{uuid}?cascade=`, `GET /{uuid}/records`,
  `POST /{uuid}/preview-query`. Reads `VIEWER`, writes `EDITOR`. Invalid queries are the service's
  `422 SF-API-0422` with `diagnostics`; a non-empty set without `cascade` is the service's `409 SF-DOM-0110` with
  `recordCount`. A uuid of another project/type is `404` (the service's own lookups — no extra pre-read in the
  controller); a `?revision=` before the set existed is `404`.
- **DTOs (new):** `AssetRefView{uuid, uid, displayName}` (a set's `dataset`, a record's `recordSet`),
  `RecordSetSummaryView`, `RecordSetDetailView` (incl. `query`, `queryValid`, `queryDiagnostics`, `changedBy`,
  `changedAt`, `deleted`), `CreateRecordSetRequest{folderUuid?, datasetUuid, uid?, displayName, query?, comment?}`,
  `UpdateRecordSetRequest{displayName?, query?, comment?}`, `RecordSetQueryPreviewView{valid, diagnostics,
  matchCount, selectedCount}` (the task asked for `{diagnostics, matchCount}`; `valid` and `selectedCount` come
  free from `RecordSetQueryPreview` and are what the query editor shows). The query itself is the sf-template
  `RecordSetQuery` record and the findings are `RecordSetQueryDiagnostic` — exposed directly, like `Diagnostic`/
  `ContentIssue` elsewhere in the DTOs; the preview body is a bare `RecordSetQuery`.
- **One parser for the grids.** `RecordController.sortKeys(HttpServletRequest)` (raw `sort` values — Spring splits
  a single `field,desc` at the comma) and `RecordController.toPageView(RecordPage)` are shared by the dataset
  listing and the set grid; `where` goes through the same `RecordGrid` code in the domain (`M25.1.2`). The set grid
  passes `folder = null` (a set is the scope) and additionally takes `applySetQuery` (default `false`) and `locale`.
- **Record create by set.** `POST /datasets/{uuid}/records` without `recordSetUuid` (the pre-M25 body with
  `folderUuid`) is now `400 SF-API-0400` with `field: "recordSetUuid"` (was `422 SF-DOM-0104` from the domain);
  a set of another dataset stays `422 SF-DOM-0104`. New helper `ProblemFactory.badRequest(detail, field)`
  (sf-common); record set create uses it for a missing `datasetUuid`. The record create endpoint stays under the
  dataset path (no new `/record-sets/{uuid}/records` POST — not asked for; the set determines the dataset anyway).
- **`RecordDetailView.recordSet {uuid, uid, displayName}`**: `RecordDetail` gained `recordSetDisplayName` (the set's
  current version, like the existing `folderUuid`), filled in `RecordServiceImpl.toDetail`.
- **`DatasetDetailView.brokenRecordSets`** (`List<BrokenRecordSet>`, filled on the update response only);
  `channelTemplates`/`recordTemplateDiagnostics` were already there (`M25.2.1`).
- **Role of `preview-query`: `EDITOR`** — it is query-editor tooling and a `POST`, like the `DEVELOPER`-gated
  `cdl/validate` / `octl/validate` for their stores' owners; a viewer gets `403`.
- **Generic endpoints verified, no change needed:** `/assets/{uuid}/move` (set into a folder; set into a set, record
  into a folder, record into another dataset's set → `422 SF-DOM-0104`), `display-name`, `uid` (`DEVELOPER`, as for
  every type), `history`, `usages` (+`?revision=`), `restore` of a cascade-deleted set (records come back), generic
  `DELETE` of a non-empty set (`409 SF-DOM-0110`).
- **OpenAPI / `schema.d.ts` regenerated** with the existing mechanism: `./gradlew :server:sf-app:generateOpenApi
  -Pfrontend.skip=true` then `cd ui && npm run generate:api` → `ui/src/app/core/api/generated/schema.d.ts` (this
  also picks up the unexported M25.1.x/M25.2.1 changes: `FolderView.type/recordCount`, `CreateRecordRequest`,
  `channelTemplates`; springdoc operation ids renumbered). **No UI call site needed changing**: the content UI uses
  hand-written request types, so `ng build` stays green — but it still sends `{folderUuid, …}` when creating a
  record, which is now a `400` at runtime (it has been a `422` since `M25.1.1`); `M25.5.1` switches it to
  `recordSetUuid`.
- `docs/api.md`: new §6.3 Record sets; §6.2 updated (record create `400`, `recordSet` on the record, dataset listing
  across sets, `brokenRecordSets`/`recordTemplateDiagnostics` on the dataset update response); `SF-API-0400` row
  names `field`.
- **Tests.** `RecordSetApiTest` (sf-app, 8: roles per endpoint incl. `403` for VIEWER writes/preview and DEVELOPER
  allowed; list/detail shapes; `400` without `datasetUuid`; `If-Match` `412`/`409` and time travel incl. `404`
  before creation; `422` diagnostics on create and update with no revision written; preview valid/invalid without
  writing; set grid with `applySetQuery` — stored order, request `where` intersection, request `sort` re-sort,
  paging — and without it, the shared `where`/`sort` `400`s, dataset listing spanning sets; `409` delete, generic
  delete `409`, cascade, restore via `/assets`; record create by set with `recordSet` in create/detail and the old
  shape `400` naming `recordSetUuid`; generic move/display-name/uid/history/usages incl. the `SF-DOM-0104` shape;
  another project's set `404` everywhere). `DatasetApiTest`: the folder-filter test now expects the `400`, new
  `aSchemaChangeThatBreaksASetQueryListsTheSetOnTheUpdateResponse` (`brokenRecordSets` over REST, empty on reads,
  `queryValid:false` on the set).
