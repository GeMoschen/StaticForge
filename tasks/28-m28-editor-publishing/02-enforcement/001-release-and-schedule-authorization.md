---
id: M28.2.1
status: done
depends: [M28.1.1]
epic: m28-editor-publishing
feature: enforcement
area: backend
---

# M28.2.1 — Release and schedule endpoints follow the publish policy

## Context

M27 endpoints: release / unpublish / discard (single asset and the Changes-view batch), `/projects/{key}/schedules`
(create, edit, re-pin, cancel, take over, run history), scheduler engine (`SchedulerEngine`) and handler SPI
`ScheduledActionHandler` (`type()`, `validate(params, actor)`, `requirements(params)`, `execute(ctx)`), action types
`RELEASE`, `UNPUBLISH`, `GENERATION`, `RECURRING_GENERATION` with the optional "then generate" step. M27 guards them
all with `DEVELOPER`. `ProjectAuthorizationService.can`, `PublishPermissionEvaluator` (`M28.1.1`). Epic decisions
8, 9.

## Goals

- **Release.** Release, discard and unpublish endpoints: `@PreAuthorize("@projectAuth.can(#projectKey,
  'RELEASE')")` instead of `DEVELOPER`. Read endpoints (release state, Changes view, diffs, dependency closure
  preview) stay `VIEWER`.
- **Schedules — the SPI states requirements.** M27's `ScheduledActionHandler.requirements(params)` returns
  `ActionRequirements` (minimum role + permission set) that the engine and the API both evaluate; M28 fills the
  permission set with `PublishPermission` values. `RELEASE`/`UNPUBLISH`: `{SCHEDULE_RELEASE}` plus, when "then generate" is set, the
  build permission that run would need (`INCREMENTAL_BUILD` for the default target, `FULL_BUILD` otherwise — the rule
  lives in `GenerationAuthorization` from `M28.2.2`; if that task isn't merged yet, build this task on the shared
  function signature and wire it when both are in). `GENERATION`/`RECURRING_GENERATION`: minimum role `DEVELOPER`.
- **Schedule API rules.**
  - Create / edit / re-pin: caller must satisfy the requirements of the action **as saved** (editing a schedule to
    add "then generate" to another target needs `FULL_BUILD`).
  - Cancel / edit another user's action: `DEVELOPER+`; the owner may cancel/edit their own while they satisfy its
    requirements.
  - Take over: caller must satisfy the requirements; ownership moves to the caller (audit as M27 defines it).
  - List/detail/history: `VIEWER`.
  - Denials are `403 SF-API-0403` with `permission` (or `"ROLE:DEVELOPER"`).
- **Execution re-check.** M27's engine re-checks the owner at execution; implement that hook with
  `PublishPermissionEvaluator` against the same `requirements(params)`. A miss fails the execution with M27's
  "creator no longer permitted" outcome and names the missing permission in the execution message.

## Acceptance criteria

- [x] Integration tests per endpoint: `EDITOR` without `RELEASE` → `403` with `permission: "RELEASE"`; with it → the
      M27 behaviour; `VIEWER` → `403` regardless of policy; `DEVELOPER` unaffected by an empty policy.
- [x] Schedules: an editor with `SCHEDULE_RELEASE` creates a `RELEASE` schedule; adding "then generate" needs
      `INCREMENTAL_BUILD` (default target) / `FULL_BUILD` (other target); creating `GENERATION` or
      `RECURRING_GENERATION` as editor → `403 "ROLE:DEVELOPER"` even with every toggle on.
- [x] Editor edits/cancels own schedule; cancelling a developer's schedule → `403`; take-over follows requirements.
- [x] Execution: editor schedules a release, admin switches `SCHEDULE_RELEASE` off, the tick executes → execution
      `FAILED` with "creator no longer permitted (SCHEDULE_RELEASE)"; nothing released; a developer takes over and
      reruns → released.
- [x] Same for a demoted owner (role changed to `VIEWER`) and a disabled owner.
- [x] Regenerated `schema.d.ts` committed (if any response shape changed); `./gradlew build` green.

## Out of scope

- Generation endpoints (`M28.2.2`), the matrix walk (`M28.2.3`), UI.

## Notes / hazards

- `requirements(params)` stays the single source of truth for API and execution checks. Update every M27 handler
  and its tests to return the permissions below.
- A schedule's "then generate" is part of the action, so the check at save time must use the target id **as
  stored**; a target that stops being the default later changes the requirement — the execution re-check catches it.
- Archived projects: M27 doesn't execute them; nothing to add here.
