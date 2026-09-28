---
id: M30.7.2
status: blocked
depends: [M30.3.2, M30.6.1, M30.6.2, M30.6.3]
epic: m30-quality-checks-and-redirects
feature: docs-e2e
area: qa
---

# M30.7.2 — Quality checks and redirects Playwright journey

## Context

`ui/e2e/` (self-seeding journeys like `m26-journeys.spec.ts`, gated on `SF_RUN_E2E`), dev stack (memory "Running
StaticForge locally"; scratch `SF_DB_FILE`, media, output and search roots for a clean run), a filesystem target whose
output folder the test can read.

## Goals

One self-seeding journey (`ui/e2e/m30-journeys.spec.ts`), every step as a real user would do it:

1. A developer creates a project with a page template whose markup has a `<title>`, `lang` and one `h1`, and a section
   template with an image; an editor creates two pages, one with an image that has no alt text and a link to the other
   page with a `#missing` anchor, and releases both (M27).
2. The page editor's Issues panel shows the missing alt (click → jumps to the section) and the missing anchor; a
   required field left empty shows under *Content*.
3. A developer runs a full build: the run details list the seeded findings; the run is `SUCCESS` (warnings only).
4. In the Quality tab the developer sets "Image without alt" to *Error*; the next build (planned full — rules changed)
   holds the page back (`PARTIAL`, finding and `SF-GEN-0125` visible); the editor adds alt text on the media, releases,
   builds again → `SUCCESS`.
5. The editor moves the second page into another folder and releases; an incremental build adds an automatic redirect
   (Redirects tab: *Automatic, Active, from run #n*); the output folder contains an HTML stub at the old path whose link
   reaches the new path (open it in the browser and follow the redirect).
6. The developer enables `.htaccess` on the target, builds, and the file contains the `Redirect 301` line.
7. The editor unpublishes the first page choosing "Redirect old URL to…" the second page; after a build the old URL
   redirects.

## Acceptance criteria

- [ ] Journey green against a clean dev stack, twice in a row (self-seeding, unique names per run).
- [ ] Assert the page editor with the Issues panel open has no horizontal overflow at 1280 px.
- [ ] Defects found are fixed in their task's code with a unit/integration test each, and listed in the notes.
- [ ] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run` green.

## Out of scope

- Load testing; the 5,000-page benchmark is `M30.1.3`'s.

## Notes / hazards

- The editor needs the M28 policy toggles *Release* and *Incremental builds* switched on by the project admin at the
  start (via the settings UI, not the API), or the developer does the builds — pick one and keep it realistic.
- Wait for run completion through the UI's status (SSE), not a timer.

- **Blocked — deferred by the user (2026-09-27)**: the run was stopped on request. The spec file and the defects it found are on branch `m30-d-journey` (WIP commit `3d2cead`); all six product fixes with their tests are merged (M30 journey-fixes merge). When resuming: merge the M30 branch into `m30-d-journey`, drop its `OctlRenderer` media-field change (superseded by `09f5e6f` + `f80f738`), run the journey twice on a clean stack.
