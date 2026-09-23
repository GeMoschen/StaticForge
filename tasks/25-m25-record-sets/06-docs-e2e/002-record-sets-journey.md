---
id: M25.6.2
status: todo
depends: [M25.2.3, M25.4.1, M25.5.1, M25.5.2, M25.5.3]
epic: m25-record-sets
feature: docs-e2e
area: qa
---

# M25.6.2 — Playwright journey: record sets end to end

## Context

`ui/e2e/m19-journeys.spec.ts` covers the `M19` content store; journeys run against the dev stack (see
memory "Running StaticForge locally" and `ui/e2e/README.md`). The `M19` journey creates records directly
in folders and must be adapted to sets in this task.

## Goals

`ui/e2e/m25-journeys.spec.ts`:

1. Developer creates dataset `team` (fields `name`, `role`, `joined`) with an `html` record template.
2. Editor creates folder `staff`, record set `leadership` (dataset `team`) in it, adds three records,
   sets the query `where "role == 'lead'"`, `sort "-joined"` → match count 2 of 3.
3. Developer adds `$CMS_VALUE(recordset:leadership)$` to a page template and a reference editor
   `featured { assetTypes [RECORD_SET] dataset "team" }` rendered with `$CMS_FOR(m : featured, limit=1)$`.
4. Editor picks `leadership` in the page's `featured` editor; preview shows both renderings in the
   expected order.
5. Generation (incremental) after editing a non-lead record does **not** rebuild the page (insight shows
   no entry for it); editing a lead does (reason names the record and set).
6. Export the page selectively → archive contains set + dataset as implicit; import into a fresh project →
   preview identical.
7. Time travel to before step 2's query save → set query panel read-only and preview shows the unfiltered
   order.

Also update `m19-journeys.spec.ts` for the new create-record flow (inside a set).

## Acceptance criteria

- [ ] `m25-journeys.spec.ts` and the updated `m19-journeys.spec.ts` green locally (`npx playwright test`).
- [ ] No `waitForTimeout`; assertions on visible text/roles only.

## Out of scope

- Performance assertions (covered by `M25.2.3`'s benchmark).
