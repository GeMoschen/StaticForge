---
id: M26.5.2
status: todo
depends: [M26.4.1, M26.4.2, M26.4.3, M26.4.4]
epic: m26-user-management
feature: docs-e2e
area: qa
---

# M26.5.2 — User management Playwright journey

## Context

`ui/e2e/` (self-seeding journeys like `m25-journeys.spec.ts`, gated on `SF_RUN_E2E`), dev stack (memory "Running
StaticForge locally"; the dev H2 database is file-based now — use a scratch `SF_DB_FILE` for a clean run).

## Goals

One self-seeding journey (`ui/e2e/m26-journeys.spec.ts`), every step as a real user would do it (lessons: never
click what a user wouldn't):

1. Admin opens Administration from the user menu, creates `editor-e2e` with a generated password and an `EDITOR`
   membership in a fresh project; copies the one-time password.
2. `editor-e2e` logs in, is forced to set a new password (policy hints visible, a too-short one is rejected), then
   lands on the dashboard and sees exactly that project.
3. Admin creates `pa-e2e` (project admin of the project) and `viewer-e2e` (no memberships); `pa-e2e` adds
   `viewer-e2e` as `VIEWER` via the Members tab lookup and changes them to `EDITOR`; `editor-e2e` sees the Members
   tab read-only, without emails.
4. Admin disables `editor-e2e` while they have the project open: their next action ends on the login page; login is
   refused; enable restores access.
5. Admin archives the project: `editor-e2e` no longer sees it; admin sees the banner and no enabled edit control on
   the pages view; unarchive brings it back.
6. `editor-e2e` changes display name and signs out everywhere; admin deletes a throwaway user (type-to-confirm) and
   the audit tab shows `USER_CREATED`, `USER_DISABLED`, `PROJECT_ARCHIVED`, `USER_DELETED` filtered by action.

## Acceptance criteria

- [ ] Journey green against a clean dev stack, twice in a row (self-seeding, unique names per run).
- [ ] Defects found are fixed in their task's code with a unit/integration test each, and listed in the notes.
- [ ] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run` green.

## Out of scope

- Load/security testing beyond the journey.

## Notes / hazards

- Two browser contexts (admin + user) in one test; the "disable while open" step must wait for the user's next
  request, not a timer.
