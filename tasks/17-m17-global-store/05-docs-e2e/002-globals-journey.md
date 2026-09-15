---
id: M17.5.2
status: todo
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
