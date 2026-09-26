---
id: M28.2.2
status: done
depends: [M28.1.1]
epic: m28-editor-publishing
feature: enforcement
area: backend
---

# M28.2.2 — Generation: policy-based start/plan/cancel, comment, startedBy, audit

## Context

`GenerationController` (start/plan/cancel/promote: `DEVELOPER`; `toRequest` defaults a missing `mode` to `FULL`),
`GenerationRequestDto`, `GenerationRequest`, `GenerationService.start` (`startLock`, `findActive` → `409
SF-GEN-0500`, `resolveTarget`: explicit → default → first), `GenerationService.cancel` (any QUEUED/RUNNING run),
`GenerationRun` (`started_by`, no comment column), `GenerationRunView` (no `comment`, no `startedBy`),
changelog `v1.0/009-generation-run.xml`, `AuditService`. M27's scheduler starts runs for `GENERATION`,
`RECURRING_GENERATION` and "then generate". Epic decisions 6, 7, 11.

## Goals

- **One rule for generation requests.** `GenerationAuthorization` (sf-generate or sf-domain, callable without a
  request context): `requiredFor(projectId, GenerationRequest)` → `INCREMENTAL_BUILD` when `mode == INCREMENTAL`
  (explicitly), `revision == null` and the target is absent or the project's default; `FULL_BUILD` for a FULL mode
  (including a missing mode) or another target; minimum role `DEVELOPER` when `revision != null`. A missing default
  target: the rule falls through to `resolveTarget`'s existing 422.
- **Endpoints.**
  - `POST /generations` and `POST /generations/plan`: `@projectAuth.has(#projectKey, EDITOR)` at the annotation (so
    `VIEWER` is `403` early), then the controller evaluates `GenerationAuthorization` for the body via
    `ProjectAuthorizationService.can`/role → `403 SF-API-0403` with `permission` (`INCREMENTAL_BUILD`, `FULL_BUILD`
    or `"ROLE:DEVELOPER"`). An incremental request whose plan falls back to full (`fallbackCause`) is allowed.
  - `POST /{runId}/cancel`: `DEVELOPER+` any run; `EDITOR` holding `INCREMENTAL_BUILD` only runs with
    `started_by` = caller, else `403`. Cancelling a scheduled run: the run's `started_by` is the schedule owner.
  - `POST /{runId}/promote`: unchanged (`DEVELOPER`).
  - The scheduler's run starts call `GenerationAuthorization` for the owner through `PublishPermissionEvaluator`
    (shared with `M28.2.1`'s "then generate" requirement).
- **Attribution.** Add `generation_run.comment` (varchar 500, nullable) to `v1.0/023-publish-policy.xml`; store the
  request's comment (trimmed, blank → null, over 500 → `400`). `GenerationRunView` gains `comment` and
  `startedBy {id, displayName}` (deleted user → display name "Deleted user"; `null` when unknown).
- **Audit.** `GENERATION_STARTED` (target `generation:<runId>`, detail `{mode, targetId, channels, scoped,
  revision, scheduledActionId?}`), `GENERATION_CANCELLED`, `GENERATION_PROMOTED` (detail `{runId, targetId}`), all
  project-level; the actor is the caller or the schedule owner. Add UI labels in
  `ui/src/app/features/admin/admin-audit.util.ts` for the three actions and `PUBLISH_POLICY_SET`.
- Regenerate OpenAPI and `ui/src/app/core/api/generated/schema.d.ts`.

## Acceptance criteria

- [x] Unit tests for `GenerationAuthorization.requiredFor`: missing mode → FULL_BUILD; INCREMENTAL + no target →
      INCREMENTAL_BUILD; INCREMENTAL + default target id → INCREMENTAL_BUILD; INCREMENTAL + other target →
      FULL_BUILD; any revision → ROLE:DEVELOPER; scoped incremental → INCREMENTAL_BUILD.
- [x] Integration: editor with `INCREMENTAL_BUILD` starts an incremental run to the default target (`202`); a FULL
      request or a second target → `403 permission: FULL_BUILD`; with `FULL_BUILD` both succeed; `VIEWER` → `403`;
      dry run follows the same answers.
- [x] Incremental request that falls back to a full plan (channel settings changed) succeeds for the editor and the
      run's plan summary shows `fallbackCause`.
- [x] Cancel: editor cancels their own queued run; another user's run → `403`; developer cancels any.
- [x] `comment` round-trips; `startedBy` shows the caller, and "Deleted user" after anonymizing the starter.
- [x] Audit entries for start (manual and scheduled, with `scheduledActionId`), cancel and promote.
- [x] Regenerated `schema.d.ts` committed; `./gradlew build` green.

## Out of scope

- Generation rate limiting; retry endpoint; target management rights (unchanged).

## Notes / hazards

- The body check happens after `@PreAuthorize`, so a `403` for the body must not leak whether a target id exists in
  another project — resolve the target within the project first (404 as today), then authorize.
- `GenerationService.start` runs under `startLock`; don't read the membership/policy inside the lock.
- The in-memory idempotency map (`GenerationService.idempotencyKeys`) is keyed by the header only; an editor reusing
  a key must not receive another user's run — scope the key by project and user while touching this (M29 evicts the
  map).
