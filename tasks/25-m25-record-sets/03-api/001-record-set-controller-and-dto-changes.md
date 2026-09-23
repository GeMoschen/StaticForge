---
id: M25.3.1
status: todo
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

- [ ] MockMvc/integration tests per endpoint incl. role checks (VIEWER cannot write, EDITOR can), `ETag`/
      `If-Match` conflict, time-travel `?revision=`, `422` diagnostics for a bad query, `409` delete.
- [ ] `applySetQuery=true` + request `where` returns the intersection, ordered by request `sort` when given.
- [ ] Creating a record with the old request shape fails with `400` naming `recordSetUuid`.
- [ ] `schema.d.ts` regenerated and the UI still compiles (type errors fixed in `M25.5.*`, but the build must
      not be left broken — stub-adjust call sites if needed).

## Out of scope

- UI (`M25.5.*`).

## Notes / hazards

- Keep `where`/`sort` parameter semantics byte-for-byte those of the `M19` record listing — one parser.
