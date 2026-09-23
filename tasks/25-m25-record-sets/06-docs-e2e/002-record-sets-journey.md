---
id: M25.6.2
status: done
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

- [x] `m25-journeys.spec.ts` and the updated `m19-journeys.spec.ts` green locally (`npx playwright test`).
- [x] No `waitForTimeout`; assertions on visible text/roles only.

## Out of scope

- Performance assertions (covered by `M25.2.3`'s benchmark).

## Implementation notes (2026-09-23)

- **`ui/e2e/m25-journeys.spec.ts`** — one self-seeding journey (two fresh projects, the import target created
  before the login because the session reads project roles at login), run at **1280 × 800**:
  1. *UI:* Templates → New dataset `Team` → CDL `name`/`role`/`joined` → tab "Record template (html)" (empty
     state, field chips from the unsaved CDL) → one save; the first text field became the title field.
  2. *UI:* Content → New folder `staff` → New record set `Leadership` (uid derived, dataset preselected) →
     three records through the set view's "New record" + record editor autosave (breadcrumb back to the set).
  3. *REST:* page template with `$CMS_VALUE(recordset:leadership)$` and `featured { assetTypes [RECORD_SET]
     dataset "team" }` rendered by `$CMS_FOR(m : featured, limit=1)$`; page `Team`; a `Products` dataset with a
     `Catalogue` set as the picker's negative case.
  4. *UI:* the `featured` picker lists `Leadership` (badge `Team`, "3 records") and not `Catalogue`; the pick
     autosaves and the preview renders every record in the default order.
  5. *(2b) UI:* the set query `role == 'lead'` + sort key `joined` descending → "2 of 3 records match", saved
     (`{where, sort}` stored), grid dims `Linus` in "All records", "Show as rendered" lists Grace, Ada; the
     preview renders Grace, Ada and `featured` → Grace.
  6. *Generation (REST runs, UI insight):* FULL; editing the non-lead → INCREMENTAL run whose "Rebuilt pages" has
     no `team.html`; editing a lead → `team.html` only, chain `page:team — reads record set containing leadership`
     ← `record:ada`. With `SF_E2E_OUTPUT_ROOT` the build's `team.html` holds the new lead order.
  7. *UI:* export picker — page `Team`, template `Team page` and set `Leadership` under folder `staff` (records
     never listed); the archive (read by a small ZIP reader in the spec) holds page/template/set/3 records as
     explicit, dataset `team` and folder `staff` as implicit, never `products`. Import screen in the fresh
     project: no conflicts, import, `GET /preview/pages/{uuid}` byte-identical to the source's and the preview
     shows the same order.
  8. *UI:* time travel to the revision before the query save: query panel read-only with no query (no Save / Add
     sort key), the grid lists the set **as of that revision** (the old names, nothing dimmed), the preview shows
     the unfiltered order.
  Layout at 1280 px (`expectLaidOut`: the element inside the viewport, no descendant wider than its box, no
  sideways page scroll) for the dataset record-template tab, the set view with the query panel, the grid, the
  set view in time travel and the record-set picker; the picker row's name/badge geometry is asserted too.
- **Deviation — step order.** The query (task step 2's last action) is saved *after* steps 3–4: step 7 travels to
  "before the query save" and must preview the page there, which did not exist yet at that revision in the task's
  literal order. Every step's assertion is kept; step 4 additionally proves the unfiltered order.
- **Deviation — step 6 "set + dataset as implicit".** A picked page never pulls in what it references
  (`M10.1.1`: not even its template), so exporting "the page" alone can't carry the set. The journey picks what a
  user picks in the export UI — page, template and the set (a container pick: set + records explicit) — and the
  dataset (and the set's folder) arrive as implicit picks.
- **`m19-journeys.spec.ts`:** records are seeded into a set (`POST /record-sets`, `recordSetUuid`); journey 2 opens
  the set from the Content store's set list (Team chip) and creates the record from the set view; the way back to
  the grid is the record editor's breadcrumb. Journeys 1, 3, 4 unchanged apart from seeding.
- **Bugs found in the running app and fixed** (each with a test):
  1. *Set/record folder paths read as stored paths* — the REST API sends `folderPath` store-relative (`/staff/`,
     `ContentStorePaths.relative`), the UI ran it through `relativeFolderPath` (which expects `/content_root/…`)
     and got `/` for everything: the set view's and record editor's breadcrumb lost the folder, **selecting a folder
     in the Content tree listed none of its sets**, move targets showed `/`. New `storeFolderPath` for DTO paths
     (`relativeFolderPath` stays for folder-tree node paths); spec fixtures used the wrong shape and hid it — now
     the API's. Tests: `content-tree.util.spec` (`storeFolderPath`, move-target detail),
     `content.component.spec` (folder narrows the set list), `record-set-view.component.spec` (breadcrumb).
  2. *Export picker didn't know folders created in the Content screen* — `ProjectContextStore.contentFolderTree`
     was loaded once per project and the Content screen never refreshed it, so a set in a new folder was invisible
     (and unexportable) in the Content scope until a full reload. New
     `ProjectContextStore.updateContentFolderTree`, fed by every Content-store reload. Tests:
     `project-context.store.spec` (new), `content.component.spec`.
  3. *Record-set picker row* — the dataset badge stretched across the whole row (column flex item) and pushed the
     meta line down. Name and badge now share a line (`.dialog__item-head`). Asserted in the journey (geometry +
     layout check).
  4. *Duplicate "Name" column* — with a title field the grid showed the display name and the same field twice.
     `deriveColumns(definition, titleEditor)` starts the title field hidden (still in the Columns chooser). Test:
     `record-grid.util.spec`; journey asserts one "Name" header.
  5. *Set query sent `null` parts* — `docs/api.md` §6.3 says absent parts are left out; responses carried
     `"limit": null, "offset": null`. `RecordSetQuery` is `@JsonInclude(NON_NULL)` (REST only — the payload is
     written by `toJson()`). `RecordSetApiTest` now asserts the keys are absent (`doesNotExist()` passed on
     explicit nulls, which is why it slipped through). No OpenAPI / `schema.d.ts` change.
  6. *Import screen kept an archive across a project switch* — the router reuses the screen for `/p/a/settings/…`
     → `/p/b/settings/…`; a loaded archive (analyzed against `a`) stayed armed and "Import" would commit it into
     `b`. The journey hit it as a race. The panel now resets (and drops an analysis in flight) when `projectKey`
     changes. Test: `project-settings-import.component.spec`.
- **Observed, not changed:** the reference editor's "Choose…" button gets the whole field as its accessible name
  (`sf-field` wraps it in a `<label>`, the M19 pattern the journeys already select by `/^Featured/`); the
  generation runs table doesn't fill the settings width. Both pre-date M25 and are outside this feature.
- **Runs** (dev stack, `bootRun -Pfrontend.skip=true` + `ng serve`, Admin/Admin): `m25-journeys` 1/1 and
  `m19-journeys` 4/4 green together; `m20-journeys` + `m21-journeys` (selectors changed in `M25.5.2`) 2/2 green.

