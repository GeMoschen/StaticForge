# Feature: API — datasets and records

**Spec:** Extends §20.1 (conventions: paging envelope, `If-Match: "rev-{n}"`, RFC 9457 problems)
and §20.2 (endpoint catalogue).

## Goal

Expose `DatasetService` / `RecordService` over REST following the conventions in `docs/api.md`
(`?page=0&size=50&sort=…`, envelope `{content:[…], page:{…}}` — today only `AssetController.list`
follows it) and the per-project authorization model (`@PreAuthorize("@projectAuth.has(#projectKey,
ProjectRoleExpr.X)")`). Record listing supports server-side filtering with the `M19.3.1` query model
so the UI grid never downloads a whole dataset.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-dataset-record-controllers.md](001-dataset-record-controllers.md) | `M19.1.2`, `M19.3.1` |

## Feature exit criteria

- [x] Dataset and record CRUD endpoints with correct roles, `If-Match`, 404-vs-403 behavior.
- [x] Paged, sortable, filterable record listing per dataset.
- [x] OpenAPI regenerated; `ui/src/app/core/api/generated/schema.d.ts` updated.

## Dependencies

`M19.1.2` (services), `M19.3.1` (query model used by the listing filter), `M8.1.5`
(`NavigationController` — the most recent controller precedent).
