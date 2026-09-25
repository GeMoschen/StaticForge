---
id: M29.6.2
status: todo
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

- [ ] Journey green against a clean dev stack, twice in a row (self-seeding, unique names per run).
- [ ] Defects found are fixed in their task's code with a unit or integration test each, and listed in the notes.
- [ ] Full `./gradlew build` (`test --rerun`), `npm run build` and `npx vitest run` green.

## Out of scope

- Killing the backend mid-build inside Playwright: interrupted-run recovery is covered by `M29.2.1`'s integration
  test.

## Notes / hazards

- Don't click what a user wouldn't (lessons). In particular, don't trigger jobs through the API from the test when the
  step is about the UI.
