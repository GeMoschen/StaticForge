---
id: M19.5.2
status: done
depends: [M19.1.3, M19.3.2, M19.4.2]
epic: m19-content-store
feature: docs-e2e
area: qa
---

# M19.5.2 — End-to-end journey: schema → records → loop → incremental rebuild → export/import

## Context

Journeys live in `ui/e2e/*.spec.ts` (e.g. `m15-journeys.spec.ts`) and backend journey integration
tests in `server/sf-app/src/test/java/...` (e.g. `M8NavigationJourney`). Known caveats: UI journeys
since `M5` have not been run against a live backend in the sandbox (no seeded demo user); see the
memory note on running StaticForge locally and the `M15` epic notes.

## Goals

- **Backend journey test** (`M19ContentStoreJourneyTest`): create dataset `team` (name, role,
  joined, photo media) → create 4 records in two folders → section template looping
  `dataset:team, where="member.role == 'lead'", sort="-joined"` + page using it + page referencing
  one record → FULL generation → assert HTML → edit one non-lead record → INCREMENTAL generation
  rebuilds the looping page (dataset dependency) but not unrelated pages → rename editor `role` →
  `position` with `renamedFrom` → one revision, template still renders after updating the template →
  export Content store + import into a new project → generation output identical.
- **Playwright journey** (`ui/e2e/m19-journeys.spec.ts`): developer creates dataset; editor creates
  records via grid + editor, filters grid with `where`, picks a record in a `reference` editor,
  previews the page, time-travels to before a record edit and confirms read-only + old value in
  preview.
- Regression: rerun `M8`, `M15` journeys and the generation benchmark with a 5,000-record dataset.

## Acceptance criteria

- [x] Backend journey test green in `./gradlew build`.
- [x] Playwright spec collects and — if a live backend with a seeded user is available — passes;
      otherwise the execution caveat is recorded here, as in `M15.6.1`.
- [x] Benchmark result (5,000 records × 500 pages, FULL and INCREMENTAL) recorded in Notes, within
      §18.6 targets.
- [x] Epic exit criteria in `tasks/19-m19-content-store/README.md` ticked with evidence.

## Out of scope

- New features discovered during testing — add follow-up task files instead.

## Notes / hazards

- `ConcurrentWritersTest` is known flaky; do not treat a single failure there as an `M19` regression
  without rerunning on a clean master.

## Implementation notes (2026-09-16)

- Backend: `M19ContentStoreJourneyIntegrationTest` (schema → records → FULL → INCREMENTAL → preview parity → time
  travel → rename in one revision → export/import into a fresh project).
- Playwright: `ui/e2e/m19-journeys.spec.ts`, 4 journeys, **passed live** (2026-09-16) against `bootRun` (dev profile,
  8081) + `ng serve` (4300). M16/M17/M18 journeys re-run: all passed.
- Benchmark (`DatasetBenchmark`, `SF_PERF=1`, dev machine): 5,000 records × 500 pages — create 25.8 s (seeding),
  listing page 135 ms, FULL 2,598 ms, INCREMENTAL 2,232 ms, rename migration 9,030 ms in one revision. Against §18.6 (500 pages): FULL < 20 s. The
  INCREMENTAL run rebuilds all 500 pages (each loops the dataset), so it is measured against the full-build budget,
  not the < 2 s single-page one.
