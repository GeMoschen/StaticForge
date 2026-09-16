---
id: M17.5.2
status: done
depends: [M17.3.1, M17.4.1]
epic: m17-global-store
feature: docs-e2e
area: qa
---

# M17.5.2 — E2E journey: global property set from creation to incremental publish

## Context

- **Playwright journeys.** They live in `ui/e2e/` (e.g. `m15-journeys.spec.ts`, `m6-journeys.spec.ts`).
  Since `M5`, journeys have been written and collected but not run against a live backend
  in this sandbox (no seeded demo user; see
  `tasks/15-m15-compound-revisions/06-e2e-verification/001-project-setup-one-revision-journey.md`).
  Per the local memory note, a memory-only token navigation trick makes a live run
  possible when the dev backend + `ng serve` are up.
- **Backend journeys.** Backend-level journey tests exist as integration tests (e.g.
  `M8NavigationJourney`).

## Goals

- **Backend journey test** `M17GlobalsJourneyTest` (Spring integration, H2):
  1. Create project → create set `site` (CDL: `title` text required, `logo` media,
     `showBanner` boolean) → set values.
  2. Page template header uses `$CMS_VALUE(CMS_GLOBAL.site.title)$`,
     `$CMS_REF(CMS_GLOBAL.site.logo)$` and `$CMS_IF(CMS_GLOBAL.site.showBanner)$`. A second
     page template doesn't use globals.
  3. Two pages on template 1, one page on template 2 → `FULL` generation → assert output.
  4. Change `site.title` → `INCREMENTAL` generation → assert the plan has exactly the two
     template-1 pages and the output has the new title.
  5. Rename editor `title` → `siteTitle` with `renamedFrom`, and update the template → value
     preserved; one revision each.
  6. Try to delete `site` → refused (in use). Usages list the template and pages.
  7. Time-travel preview at the revision before step 4 shows the old title.
- **Playwright journey** `ui/e2e/m17-journeys.spec.ts`: create the set through the UI,
  fill values as an editor, confirm the Schema tab is read-only for the editor, preview a
  page showing the value, check the time-travel read-only state on the Globals screen.
- **Regression pass.** Run the `M15`/`M16` revision-invariant and export/import suites to
  confirm the new asset type and root folder broke nothing.
- Record exactly what was run live and what was only collected, in this file's Notes when
  done (same honesty standard as `M15.6`).

## Acceptance criteria

- [ ] `M17GlobalsJourneyTest` passes, covering steps 1–7.
- [ ] `ui/e2e/m17-journeys.spec.ts` exists and is collected by Playwright. It has been run
      live, or its non-execution is documented with the reason.
- [ ] The full `./gradlew build` is green, and `ui` `npm run build` is green.
- [ ] Every checkbox in the epic README exit criteria has been verified or annotated.

## Out of scope

- Performance benchmarking of globals fan-out (covered by the generic `M4` benchmark if needed).

## Notes / hazards

- `ConcurrentWritersTest` is known to be flaky (see local memory note). If it fails, rerun
  it on a clean `master` worktree before attributing the failure to this epic.

## What was run (2026-09-16)

- **Backend journey:** `M17GlobalsJourneyIntegrationTest` covers steps 1–7 and passes. Step 6 checks usages
  against the current model: they list the referring template, and not the pages, because a page's read of a
  set is not persisted as an edge (see the epic README note on that criterion). The incremental plan is checked
  through `SnapshotService` + `BuildPlanner`: exactly the two template-1 pages.
- **Other new backend tests:** `GlobalSetIntegrationTest` (10), `GlobalsApiTest` (7, role matrix incl. EDITOR 403
  on schema), `ProjectExportImportIntegrationTest` (+3: Globals store round trip into a fresh and into the same
  project, unselected media reported like a page's, revision diff of a value and a schema change).
- **Playwright, run live** (dev backend on 8081, `ng serve` on 4300): `m17-journeys.spec.ts` 4/4.
  - Create a set in the UI, get `SF-CDL-0107` inline, fix the CDL, save values.
  - A page preview shows the value and follows an edit made on the Globals screen.
  - Editor role: Schema read-only, Values editable. The instance admin demotes itself on a throwaway project,
    because there is no user-creation API. The server-side 403 is proven by `GlobalsApiTest`.
  - Time travel: the Globals screen is read-only and shows the old value.
- **Regression:** `m16-journeys.spec.ts` 5/5 live. Full `./gradlew build` green: 510 backend tests, 0 failures,
  1 skipped (the benchmark), plus `ng build`.
- **Bugs found and fixed by this verification:**
  - Import silently dropped every `GLOBAL_SET`: `NON_FOLDER_ORDER` didn't list it. It's now an `AssetType` list
    with a static completeness check.
  - The page editor pinned its preview to the page's own revision (the concurrency token), so template and
    cross-asset/global value changes made after the page's last save never showed in its preview. The preview
    frame now takes the time-travel revision as the pin and the page revision only as a refresh trigger
    (`refreshKey`).
