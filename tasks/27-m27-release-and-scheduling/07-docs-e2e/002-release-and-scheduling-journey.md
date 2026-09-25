---
id: M27.7.2
status: todo
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

- [ ] Journey green against a clean dev stack, twice in a row (self-seeding, unique names per run).
- [ ] The page editor with release bar and preview holds at 1280 px (elements in viewport asserted).
- [ ] Defects found are fixed in their task's code with a unit/integration test each, and listed in the notes.
- [ ] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run` green.

## Out of scope

- Multi-node scheduler testing (covered by the engine's integration test).

## Notes / hazards

- The scheduled steps must wait on observable state (execution row / badge), not fixed timers beyond the schedule
  time; set `sf.scheduler.poll-interval` low (e.g. 2 s) for the dev stack run and document it.
