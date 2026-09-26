---
id: M28.4.2
status: done
depends: [M28.3.2, M28.3.3]
epic: m28-editor-publishing
feature: docs-e2e
area: qa
---

# M28.4.2 — Editor publishing Playwright journey

## Context

`ui/e2e/` (self-seeding journeys like `m26-journeys.spec.ts`, gated on `SF_RUN_E2E`), dev stack (memory "Running
StaticForge locally"; scratch `SF_DB_FILE` for a clean run). The M27 scheduler tick (`sf.scheduler.poll-interval`)
must be short in the e2e profile.

## Goals

One self-seeding journey (`ui/e2e/m28-journeys.spec.ts`), two browser contexts (project admin, editor), every step as a
real user would do it:

1. Admin seeds a project with a default and a second target, a page template and a page; adds `editor-e2e` as
   `EDITOR`. Editor edits the page: no Release, Schedule, New generation, Cancel or Promote control anywhere; the
   generation screen shows the explanatory empty state.
2. Admin enables **Release** on the Generation tab. Without reloading, the editor's next navigation shows Release;
   the editor releases the page from the Changes view; no "Build now" offered.
3. Admin enables **Incremental builds**. Editor releases another change, clicks **Build now**, sees the run finish,
   "Started by editor-e2e" and the comment; the New generation dialog has mode and target fixed; the editor limits a
   run to a folder via the scope field.
4. Admin enables **Schedule releases**. Editor schedules a release a short time ahead with "then generate" (default
   target); it executes and the run shows it was scheduled.
5. Editor schedules another release; admin switches **Release** off → the impact dialog lists that schedule → Save
   anyway; at execution the schedule shows "creator no longer permitted"; admin takes it over and reruns it.
6. Admin enables everything incl. **Full builds**: editor starts a full build to the second target; Promote is still
   absent for the editor. Admin's audit view shows `PUBLISH_POLICY_SET`, `GENERATION_STARTED`.

## Acceptance criteria

- [x] Journey green against a clean dev stack, twice in a row (self-seeding, unique names per run).
- [x] Defects found are fixed in their task's code with a unit/integration test each, and listed in the notes.
- [x] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run` green.

## Out of scope

- Load testing; M27's own journey (release semantics are proven there).

## Notes / hazards

- Wait for scheduled executions by polling the schedule's state in the UI, not with a fixed timer.
- Step 2 must prove "applies on the next request": no re-login and no page reload in the editor context — the
  detail refresh from `M28.3.1` (visibility/403 handling) or a normal navigation must be enough.

## Notes (implementation)

- `ui/e2e/m28-journeys.spec.ts`, green twice in a row on a clean dev stack (scheduler poll 2 s), ~5 min each; the
  full-build and scoped steps assert the runs through the API (`mode`, `targetId`, `planSummary.scoped/pageCount`).
- Defects found and fixed:
  1. **Stale permissions after a policy change** (`ProjectContextStore`): the navigation refresh was throttled by time,
     so a navigation within the window after the last read dropped the refresh and the editor kept the old controls.
     Now every navigation re-reads the detail; a read in flight coalesces the others and runs once more afterwards.
     Spec: `project-context.store.spec.ts` "re-reads the permissions on every navigation…" (fails on the throttle).
  2. **Toasts were never rendered** (found while building "Build now"): `ToastService` existed since the initial commit
     without a host. Added `ToastHostComponent` (polite/assertive regions, auto-dismiss, optional action); spec
     `toast-host.component.spec.ts`. Every existing toast in the app is now visible.
- Journey-only races fixed in the test itself: the app runs zoneless, so a native checkbox click flips at once while
  the card's render (cascade, enabling) comes a tick later — the helper waits on the dependent switch.
