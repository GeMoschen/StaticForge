---
id: M29.6.2
status: done
depends: [M29.5.1, M29.5.2]
epic: m29-housekeeping-jobs
feature: docs-e2e
area: qa
---

# M29.6.2 — Housekeeping Playwright journey

## Context

- `ui/e2e/` (self-seeding journeys like `m26-journeys.spec.ts`, gated on `SF_RUN_E2E`).
- Dev stack (memory "Running StaticForge locally": use a scratch `SF_DB_FILE` for a clean run).
- Test-only seeding endpoints, if any exist from earlier journeys; otherwise seed through the public API.

## Goals

One journey, `ui/e2e/m29-journeys.spec.ts`, every step as a real user would do it:

1. The admin opens Administration → Jobs and sees every job with its next run. They open `blob-sweep`, change the
   grace period to 1 hour, save, and see the history unchanged and the new next run.
2. The admin uploads a media file in a fresh project, replaces it (the old blob is now referenced only by history) and
   deletes a second media asset. They run a blob-sweep **dry run**: the report shows both files' blobs as marked (kept,
   because history references them) and the examined/removed counts. A real run gives the same counts. The user guide
   explains that space is freed only once compaction removes the versions.
3. The developer starts a build and the admin cancels it from the generation page while it runs. It ends `CANCELLED`
   and the site's `current` build is unchanged (checked through the run list: no new published build). A second build
   starts without `409`.
4. The project admin opens project settings, enables compaction (types the project key; the estimate is shown), and
   sees `compactedThrough` after the admin runs `revision-compaction` from the Jobs page.
   - Back-dated history is needed: seed revisions through a test-profile clock or a dev-only endpoint, the same way
     other journeys seed time-dependent data. If none exists, add a `test`/`dev`-profile-only fixture endpoint in this
     task, never in `prod`.
5. Time travel to a compacted revision shows the compacted banner, and its diff shows the compacted message.
6. The audit tab filtered by `JOB_RUN` and `COMPACTION_POLICY_SET` shows the entries.

## Acceptance criteria

- [x] Journey green against a clean dev stack, twice in a row (self-seeding, unique names per run). *2026-09-27: fresh
      `SF_DB_FILE`/`SF_MEDIA_ROOT`/`SF_OUTPUT_ROOT`/`SF_SEARCH_INDEX_ROOT`, 1.1 min and 57 s.*
- [x] Defects found are fixed in their task's code with a unit or integration test each, and listed in the notes.
- [x] Full `./gradlew build` (`test --rerun`), `npm run build` and `npx vitest run` green. *`npx ng build` and *(Coordinator, 2026-09-27: `spotlessCheck test --rerun` 1475 tests, 0 failures; vitest 709; `ng build` green.)*
      `npx vitest run` (104 files, 708 tests) green; the changed backend classes' tests green
      (`DevFixtureController*`, `SecuritySmokeTests`, `ArchivedProjectEndpointWalkTest`, `PublishPermissionMatrixTest`,
      `PublishPolicyApiTest`). The full suite is left to the coordinator.*

## Out of scope

- Killing the backend mid-build inside Playwright: interrupted-run recovery is covered by `M29.2.1`'s integration
  test.

## Notes / hazards

- Don't click what a user wouldn't (lessons). In particular, don't trigger jobs through the API from the test when the
  step is about the UI.

### Notes (what was built)

- **Journey** `ui/e2e/m29-journeys.spec.ts` (one test, ~1 min; run command and prerequisites in its header). Seeds
  two projects per run through the API: a small one (page with three edits, back-dated 40 days, and one edit today)
  and a large one (400 pages whose template holds 80 000 output-free `$CMS_IF`s, released, with a first published
  build, ~7 s per full build) plus a `DEVELOPER` account. Steps 1–6 as specified, all in the UI; step 1 first presses
  *Reset to defaults* so a second run on the same instance starts from the 24 h default. Step 3 runs in two browser
  contexts: the developer starts a full build, the admin opens the generation page and cancels it while the row says
  RUNNING (asserted before the click); the run list then has the seed run as the only SUCCESS, the cancelled run wrote
  fewer files than pages, and the developer's next full build succeeds. Step 2 reads the three stored blob hashes
  from the media versions (the server re-encodes uploads to strip EXIF, so hashing the uploaded bytes is wrong),
  checks none is in the sweep's sample and, with `SF_E2E_MEDIA_ROOT`, that all three are still in the store after the
  real run; dry and real run report the same examined/affected/`marked` counts. The end of the journey checks the
  admin Jobs detail and audit pages at 390 px.
- **Back-dated history: dev/test-only fixture endpoint** (none existed; no `@Profile` bean or settable clock in main
  code). `DevFixtureController` (sf-api, `@Profile({"dev", "test"})`, `SYS_INSTANCE_ADMIN`):
  `POST /api/v1/dev/fixtures/projects/{key}/backdate-revisions` `{days (1–3650), throughRevision (≥ 1)}` moves
  `revision.created_at` of revisions `1..throughRevision` onto one UTC day `days` ago (01:00 UTC + r seconds, order
  kept); nothing else changes. Not in the OpenAPI document (generated without a profile). Tests:
  `DevFixtureControllerTest` (test profile: back-dates in order and leaves later revisions; project admin `403`;
  out-of-range `422`) and `DevFixtureControllerProfileTest` (`ApplicationContextRunner`: absent without a profile and
  with `prod`, `demo`, `default`; present with `dev`, `test`).
- `sf.housekeeping.enabled` is `true` in `dev` (off only in `test`); *Run now* works regardless (runs synchronously in
  the request).

### Defects found and fixed

1. **Compaction card** (M29.5.2): the last run showed the raw outcome enum ("SUCCEEDED") and "1 versions" /
   "in 1 assets" in the card and the estimate. Now `outcomeLabel` ("Succeeded", as on the Jobs page) and singular
   counts. Spec: `project-settings-compaction.component.spec.ts` (outcome in words; "1 version" / "1 asset").
2. **Admin pages scrolled sideways on a phone** (M29.5.1 job detail, also the audit page): the `.sf-sr-only` heading
   of a table's last column is absolutely positioned and escaped the table's scroll frame, widening the document to
   ~840 px at 390 px. `.table.sf-table-wrap { position: relative }` in `_admin.scss`; the job detail's two columns
   now use `minmax(min(22rem, 100%), 1fr)` so the panels fit too. Journey asserts no side scroll on audit and job
   detail at 390 px and the settings panel inside the gutter (CSS-only, not testable in vitest).
3. **Audit Actions filter cut off its options** (M29.5.1 added "CODE — label" options to a 16rem list):
   `.filter--actions` is `min(28rem, 100%)`. Journey asserts the list's `scrollWidth <= clientWidth` (16rem: 432 >
   254; now 446 = 446).

### Noticed, not changed

- A Revisions-list row opens the diff without entering time travel; only spine ticks (newest 40) do. Old compacted
  revisions of a busy project are reachable for time travel only through a record's History panel (pre-existing).
- Project settings → General's *Save changes* is enabled with nothing changed (pre-existing, M8-era form).
- The `media-library.component.scss` budget warning in `ng build` is pre-existing.

