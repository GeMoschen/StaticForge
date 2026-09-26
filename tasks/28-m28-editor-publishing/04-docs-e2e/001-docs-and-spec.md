---
id: M28.4.1
status: done
depends: [M28.2.3, M28.3.3]
epic: m28-editor-publishing
feature: docs-e2e
area: qa
---

# M28.4.1 — Spec and docs

## Context

`cms-specification.md`, `docs/api.md`, `docs/user-guide.md`, `docs/administration.md`, `docs/release-readiness.md`
(G1). Epic "Spec follow-up" list.

## Goals

- Spec: §2.1 G1 (editors can publish when the project allows it), §8.3 (role table: "Generate/publish" for `EDITOR`
  becomes "per project publish policy", a sub-table of the four permissions, what stays `DEVELOPER+`), §8.4
  (`can(projectKey, permission)`, role from token + policy per request, the domain evaluator for schedules),
  §18.1 (trigger table: who may start which run, cancel-own rule, fallback-to-full allowed), §18.5 (`comment`,
  `startedBy`), §20.2 (publish-policy endpoints + impact; changed roles on generation/release/schedule endpoints),
  §24 (Generation tab card, gated controls, scope in the dialog, Build now), §26.3 (audit actions
  `PUBLISH_POLICY_SET`, `GENERATION_STARTED`, `GENERATION_CANCELLED`, `GENERATION_PROMOTED`), Appendix B
  (`SF-API-0403` with `permission`).
- `docs/api.md`: the endpoints, the `permission` problem extension, request rules for editors.
- `docs/user-guide.md`: "Publishing as an editor" (what each toggle allows, where to release, Build now, schedules).
- `docs/administration.md`: choosing a policy per project; impact warning; what developers keep.
- `docs/release-readiness.md`: G1 evidence updated (journey `M28.4.2`).

## Acceptance criteria

- [x] Every new/changed endpoint in §20.2 with its rule; every new audit action listed.
- [x] Docs reviewed against the implemented behaviour (not the plan) — deviations recorded in the task notes.

## Out of scope

- Code changes.

## Notes (implementation)

Docs written against the code (`project/publish/*`, `GenerationAuthorization`, `ProjectAuthorizationService`,
`PublishPolicyController`, `GenerationController`, `ScheduleService`, `SchedulerEngine`, `ReleaseStateActionHandler`,
`PolicyReleasePermissionCheck`, `GenerationService`, changelog `025`) and the tests `PublishPolicyApiTest`,
`EditorGenerationApiTest`, `EditorReleaseAndScheduleIntegrationTest`, `PublishPermissionMatrixTest`.

**Changed:** `cms-specification.md` §2.1 (G1 note), §8.1 (`publish_policy` column; `publish-policy/impact` in the
archived allow-list), §8.3 (role table, policy sub-table, what stays with developers, storage), §8.4 (`can`,
`satisfies`, one rule, domain evaluator), §18.1 (who may start which run, cancel-own, fallback allowed), §18.5
(attribution), §18.7 (Authority: `PublishRequirements`), §20.2 (publish-policy endpoints, `ProjectDetail`, generation,
release and schedule roles, target roles), §23.3 (`ProjectPermissionsStore`, 403 refresh), §24.5 (items 10, 14–16,
new item 17), §26.3 (AuthZ, four audit actions), §27 (post-v1 note), Appendix B (`SF-API-0403`, `SF-DOM-0163`),
Appendix C (M28 delivered). `docs/api.md` (path count, §3 rows, new §3.3, §9, §10, §10.1, §11.1, §15),
`docs/user-guide.md` (new "Publishing as an editor (M28)", roles table, Publishing/Generate edits),
`docs/administration.md` (new "Letting editors publish (M28)", schedules owner rule, audit), `docs/release-readiness.md`
(G1 evidence, M28 release note), `docs/architecture.md` (§8, §13 fixes, new §14).

**Deviations from the plan (implemented behaviour documented):**

1. Changelog is `v1.0/025-publish-policy.xml` (023 was taken by M27's `generation_run.comment`); `025` only adds
   `project.publish_policy`. `generation_run.comment` already existed from an M27 follow-up.
2. A run comment over 500 characters is cut to 500 ending in "…" (M27 follow-up behaviour kept), not refused with
   `400`.
3. `PublishPermissionEvaluator` denies `DISABLED` and `DELETED` accounts; a `LOCKED` account (temporary sign-in
   lockout) keeps its permissions (M27.4.1 rule), where the plan said "must be ACTIVE".
4. The policy is overwritten in place like the locale config; each change allocates an `UPDATE` revision (summary
   `PROJECT` / `publishPolicy`) for attribution only. Time travel does not show a historical policy (the plan said it
   would, read-only); the audit entry's `{before, after}` is the history.
5. Role-only guards of the publishing controllers use `@projectAuth.can(#projectKey, 'ROLE:X')` (generation
   start/plan/cancel `ROLE:EDITOR`, promote and target create `ROLE:DEVELOPER`, target update/delete and publish-policy
   `PUT`/impact `ROLE:PROJECT_ADMIN`) instead of `has(...)`, so their `403`s carry `permission`. Other endpoints keep
   `has`.
6. Scheduled actions: `RELEASE`/`UNPUBLISH` need `SCHEDULE_RELEASE` (+ `INCREMENTAL_BUILD` for "then generate" to the
   default target, `FULL_BUILD` for another, on the stored target); `GENERATION`/`RECURRING_GENERATION` need
   `DEVELOPER`. Editing, cancelling, **running now** or re-pinning someone else's schedule needs `DEVELOPER` on top;
   take-over needs only the requirements. The schedule API evaluates the caller through `ActionAuthority` →
   `PublishPermissionEvaluator` (membership row), not the token. Execution failure message: "Owner no longer permitted
   (SCHEDULE_RELEASE): 'bob' is EDITOR without SCHEDULE_RELEASE in the project's publish policy." (`SF-DOM-0163`;
   recurring paused, one-off failed).
7. `ReleasePermissions` (sf-api) was removed; release endpoints use `@projectAuth.can(#projectKey, 'RELEASE')`.
   `RoleReleasePermissionCheck` was replaced by `PolicyReleasePermissionCheck`; M27's `ActionRequirements` was replaced
   by `PublishRequirements`, one requirement type for API, scheduler and generation (the plan kept `ActionRequirements`).
8. "Default target" in `GenerationAuthorization` is the target an absent `targetId` resolves to — the default, else the
   first target — matching `GenerationService.resolveTarget`.
9. A `targetId` of another project is answered `403 FULL_BUILD` like any non-default id (reveals nothing) instead of
   resolving the target first and answering `404` (plan hazard); the start then fails as before.
10. Audit details: `GENERATION_STARTED` target `generation:<runId>`, detail `{runId, targetId, mode, channels, scoped,
    revision, scheduledActionId?}`; `targetId` is the requested one (`null` when the default was implied — the entry
    is written before the target is resolved). `GENERATION_CANCELLED`/`GENERATION_PROMOTED` detail `{runId, targetId}`.
    `Idempotency-Key` is scoped by project and user.
11. No UI audit labels were added (`admin-audit.util.ts` has no label map; the audit view shows action names
    verbatim, as for every other action).
12. The generation dialog never had a "pin revision" field, so there was nothing to hide; pinning a revision is
    API-only (`DEVELOPER`).
13. UI refresh: besides a `403` with `permission` and tab visibility (≤ once a minute), the project detail is also
    re-read on every navigation inside the project (coalesced, never dropped). The app now renders toasts (`ToastHostComponent` in the
    shell); before M28 `ToastService` existed but nothing displayed its toasts. "Build now" starts its run with the
    comment "Build after release".
14. The publish policy is not part of project export archives (not in `settings.json`); recorded in the M28 release
    note.
15. Impact rows' `runAt` is the schedule's `nextRunAt`.
16. Spec corrections found on the way: §18.1's request example nested `scope`, the API takes top-level
    `folderPath`/`assetUuids`; §20.2 listed all target CRUD as `PROJECT_ADMIN`, create is `DEVELOPER`.
17. `ui/e2e/m28-journeys.spec.ts` (M28.4.2) was not yet in the repository when these docs were written;
    `release-readiness.md` references it as the G1 end-to-end evidence (gated on `SF_RUN_E2E`).
