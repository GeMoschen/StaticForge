---
id: M27.7.2
status: done
depends: [M27.6.1, M27.6.2, M27.6.3, M27.6.4, M27.6.5, M27.5.2]
epic: m27-release-and-scheduling
feature: docs-e2e
area: qa
---

# M27.7.2 — Release and scheduling Playwright journey

## Context

`ui/e2e/` (self-seeding journeys like `m26-journeys.spec.ts`, gated on `SF_RUN_E2E`), dev stack (memory "Running
StaticForge locally"; scratch `SF_DB_FILE`, media, output and search roots for a clean run). Generated output is
checked on disk under the target's `current` directory (or through the target's served path).

## Goals

One self-seeding journey (`ui/e2e/m27-journeys.spec.ts`), every step as a real user would do it (lessons: never
click what a user wouldn't):

1. Developer creates a project with locales `de` (default, no prefix) and `en`, a page template, two pages and a media
   (seeding the project skeleton through the API is fine; everything below through the UI). Pages start `New`;
   releases both pages (dependency dialog proposes the media, ticked) in DE and EN; runs a build: both pages online.
2. Edits the EN headline of page A → badge `Changed` in EN, `Published` in DE; preview Draft shows the edit, Published
   the old text; builds → EN output unchanged.
3. Opens Changes: page A (EN) listed with a diff showing only the headline; releases it there; builds → EN output
   shows the new headline, DE unchanged.
4. Renames page B's UID (structural) → both locales `Changed`; a build keeps the old path; releases EN only → EN at the
   new path, DE at the old path.
5. Localizes the media, uploads an EN file, releases EN → `en/assets/media/…` written, DE pages still link the DE file.
6. Schedules a release of a new edit of page A two minutes ahead with "then generate" (viewer time zone shown); edits
   the page again meanwhile → "Draft changed since scheduled" shown; leaves it pinned; after execution the pinned
   version is online (not the later edit), the execution history links the revision and the run.
7. Creates a recurring generation "every minute" (Advanced cron), sees next run times, cancels it after one execution.
8. Deletes page B → `Deletion pending`, still online after a build; releases the deletion → gone after the next build.
9. Exports the project and imports it into a new project with "Keep release state" → same statuses.
10. An `EDITOR` member sees statuses and the Changes view but no release/schedule actions.

## Acceptance criteria

- [x] Journey green against a clean dev stack, twice in a row (self-seeding, unique names per run).
- [x] The page editor with release bar and preview holds at 1280 px (elements in viewport asserted).
- [x] Defects found are fixed in their task's code with a unit/integration test each, and listed in the notes.
- [x] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run` green.

## Out of scope

- Multi-node scheduler testing (covered by the engine's integration test).

## Notes / hazards

- The scheduled steps must wait on observable state (execution row / badge), not fixed timers beyond the schedule
  time; set `sf.scheduler.poll-interval` low (e.g. 2 s) for the dev stack run and document it.

## Implementation notes

**Journey.** `ui/e2e/m27-journeys.spec.ts`, one test with the ten steps. The skeleton is seeded through the API:
project, languages `de` (default, no prefix) and `en`, template, two pages referencing one image, a filesystem
target, and the step-10 `EDITOR` account. Everything else happens in the UI, including every build (Settings →
Generation → New generation → Full → Start). Generated files are read from the target's live build: `current` is a
link, or on Windows a file naming the build directory. Waits are on observable state (badges, rows, the API's run
and schedule status). The only waits on time are the scheduled release's two minutes and the "every minute" cron.
The run needs `SF_SCHEDULER_POLL_INTERVAL=2s` on the backend. Each action has a 30 s timeout, so a missing control
fails fast.

Uploaded images are normalized by the server, so media outputs are compared with the bytes the server serves for
each language (`/media/{uuid}/binary?locale=`), not with the uploaded bytes.

**Defects found and fixed (each with a test):**
- **`CHANGED` with an empty diff.** After an EN-only edit made in the editor, DE also read `Changed`. The editor's
  save writes `"variant": null, "altOverride": null` into a media value that the API created without those fields.
  The locale projection compared raw JSON, so `null` ≠ absent, while the Changes diff (`JsonDiffer`) treats them as
  equal. `LocaleProjection` now drops null-valued fields at any depth.
  `LocaleProjectionTest.nullFieldIsAbsent` fails on the old code.
- **Drift shown after execution.** A succeeded (or cancelled) pinned release still said "Draft changed since
  scheduled" in the list and in the history. It is now shown only while the schedule is pending (`showsDrift`,
  covered by a spec in `schedules.component.spec.ts`).
- **Skipped local times treated differently.** Found by the docs pass (M27.7.1). A one-off time typed inside a DST
  gap was sent as java.time's shifted time (02:30 → 03:30), while a cron slot in the gap runs at the end of the gap
  (03:00). `zonedToUtc` now also resolves a gap to its end, as decision 24 says: the next valid instant. Covered by
  the Berlin spring-switch case in `zoned-time.util.spec.ts`.

**Verification.** The journey passed twice in a row on a clean dev stack (fresh H2 file, output root, scheduler
poll 2 s): see `tasks/todo.md`.
