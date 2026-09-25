# M28 — Editor publishing (per-project publish policy)

**Spec:** Extends §2.1 G1 ("editors publish page changes without developer help"), §8.3 (role table), §8.4
(authorization), §18.1 (generation triggers), §18.5 (run record: `comment`, `started_by`), §20.2 (REST catalogue),
§23/§24 (settings, generation screen), §26.3 (audit). Builds on M27 (release state, `/projects/{key}/schedules`).
Not part of the original §27 roadmap — inserted the same way `M8`–`M27` were.

## Goal

The §8.3 role table gives `EDITOR` "Generate/publish: preview only". After M27 every content change is a draft
until it is **released**, and M27 lets only `DEVELOPER+` release, schedule and build — so an editor can write but
never put anything online, which contradicts goal G1 (user request 2026-09-25).

This milestone lets a project admin decide, **per project**, what editors may do to get content online:

- **`RELEASE`** — release, discard and unpublish content (M27 release/unpublish/discard).
- **`SCHEDULE_RELEASE`** — one-off scheduled `RELEASE`/`UNPUBLISH` actions, including their "then generate" step.
- **`INCREMENTAL_BUILD`** — start incremental (optionally scoped) generation runs to the project's default target.
- **`FULL_BUILD`** — start full runs and runs to any target.

All four are **off** by default (new projects and every existing project), so nothing changes until an admin opts
in. `DEVELOPER`, `PROJECT_ADMIN` and instance admins always hold all four. Along the way it closes the gaps planning
found in the generation surface (see "Findings").

## Findings from planning (2026-09-25)

1. **No permission abstraction.** Every check is a minimum role: `ProjectAuthorizationService.has(projectKey,
   minimumRole)` (`sf-api/.../security/ProjectAuthorizationService.java:25`) reads the role from the access token's
   `projects` claim; `ProjectRoleExpr` holds the SpEL constants. `ProjectRole` ranks by ordinal
   (`VIEWER < EDITOR < DEVELOPER < PROJECT_ADMIN`, `atLeast`).
2. **Generation endpoints** (`GenerationController`): start `POST /generations`, dry run `POST /generations/plan`,
   `POST /{runId}/cancel`, `POST /{runId}/promote` all require `DEVELOPER`; history, status, stored plan and SSE
   events are `VIEWER`. `TargetController`: create `DEVELOPER`, update/delete `PROJECT_ADMIN`.
3. **A request without `mode` is a FULL run** (`GenerationController.toRequest` and `GenerationService.start`:
   `mode == null ? FULL`). A request without `targetId` goes to the default target (`GenerationService.resolveTarget`:
   explicit → default → first → 422).
4. **`comment` is dropped.** `GenerationRequestDto.comment` reaches `GenerationRequest` but `GenerationRun` has no
   column for it; `GenerationRunView` has neither `comment` nor `startedBy` (the `started_by` column exists and is set
   from `securitySupport.currentUserId()`).
5. **No audit of generation.** Run start, cancel and promote write no `audit_log` entry; only targets are audited
   (`TargetController`, `TARGET_CREATE`/`UPDATE`/`DELETE`).
6. **Cancel has no owner rule.** `GenerationService.cancel` cancels any QUEUED/RUNNING run of the project.
7. **The UI isn't role-gated.** The generation screen (`features/generation/generation.component.*`, embedded in
   Settings → Generation) shows **New generation**, **Cancel** and **Promote** to every member; an editor clicks and
   gets `403`. Settings tabs are not gated either (only Members `canManage`). Role checks elsewhere are ad hoc:
   `ROLE_RANK`/`roleRank()` from `core/auth/auth.guard.ts` in `content.component`, `dataset-schema-editor`,
   `record-editor`, `record-set-view`, `global-set-detail`; `roleFor(...) === 'PROJECT_ADMIN'` in `search-page` and
   `project-settings-members`.
8. **The generation dialog has no scope** (`generation-dialog.component.ts`: mode, target, comment, channels) even
   though the API takes `folderPath`/`assetUuids`.
9. **No project settings store.** `Project` has `allowed_mime_types` and `locale_config` (JSON) columns; settings
   changes go through dedicated endpoints (`PUT /projects/{key}`, `PUT /projects/{key}/locales`).

## Decisions (binding for all tasks — revisit only with the user)

1. **Four toggles, all off by default.** `PublishPermission { RELEASE, SCHEDULE_RELEASE, INCREMENTAL_BUILD,
   FULL_BUILD }`, stored as `project.publish_policy` (JSON, `{"editor":["RELEASE",…]}`), changelog
   `v1.0/023-publish-policy.xml`. The migration writes an empty list for every project; a new project starts empty.
   No approval / four-eyes workflow, no new role.
2. **Toggles apply to `EDITOR` only.** `VIEWER` never holds a publish permission; `DEVELOPER`, `PROJECT_ADMIN` and
   instance admins always hold all four, whatever the policy says.
3. **Implications.** `SCHEDULE_RELEASE` requires `RELEASE`; `FULL_BUILD` requires `INCREMENTAL_BUILD`. A policy that
   breaks this is `400 SF-API-0400` with one message per broken rule under `errors`.
4. **Role from the token, policy from the database — per request.** The role keeps coming from the `projects` claim
   (the M26 token epoch already makes role changes apply on the next request). The policy is read from the project
   row on every `can(...)` check, no cache, so a policy change applies on the **next request** of every editor
   without bumping anyone's epoch (bumping would force a refresh for every member, and the policy is not part of
   any claim). Publish endpoints are low-volume; one project read per check is acceptable.
5. **Two evaluators, one rule.** `PublishPermissionEvaluator` (sf-domain) decides `permitted(projectId, userId,
   permission)` from the **membership row** (role), the user's status/system role and the policy — used by the M27
   scheduler at execution time (no token there). `ProjectAuthorizationService.can(projectKey, permission)` (sf-api)
   evaluates the same rule from the token's role plus the policy, and throws `404` for non-members, like `has`.
   Both call one shared pure function (`PublishPolicy.grants(role, permission)`), tested once.
6. **Denied = `403 SF-API-0403`** with the problem extension `permission` (the missing `PublishPermission`, or
   `"ROLE:DEVELOPER"` for role-only actions). No new `SF-DOM` code is needed; `SF-DOM-0170`–`0174` stay reserved.
7. **Generation for editors.**
   - `INCREMENTAL_BUILD`: `mode` must be `INCREMENTAL` **explicitly** (a missing mode is FULL, Finding 3); `targetId`
     absent or the default target's id; `revision` must be `null` (pinning a past revision is rollback-like →
     `DEVELOPER`); `channels` any subset; `folderPath`/`assetUuids` scope allowed. An incremental request that the
     planner turns into a full plan (`fallbackCause`) is **allowed** — the fallback is the system's decision, and
     refusing it would lock editors out after e.g. a channel settings change.
   - `FULL_BUILD`: additionally `mode: FULL` and any target. `revision` stays `DEVELOPER+`.
   - Dry run (`POST /generations/plan`) applies the same request checks as start (it shows what you could run).
   - **Cancel:** an editor holding a build permission may cancel runs **they started** (`started_by` = caller); any
     other run needs `DEVELOPER`. **Promote/rollback** stays `DEVELOPER+`. Target create/update/delete unchanged.
8. **Release (M27 endpoints).** Release, discard and unpublish (single asset and the Changes view batch) require
   `can(RELEASE)`. Reading release state, the Changes view and diffs stays `VIEWER`.
9. **Schedules (M27 `/projects/{key}/schedules`).**
   - Create/edit/re-pin/cancel a `RELEASE` or `UNPUBLISH` action: `SCHEDULE_RELEASE`. Its optional "then generate"
     step additionally needs the build permission the run would need (decision 7: `INCREMENTAL_BUILD` for the default
     target, `FULL_BUILD` for another target) — checked when saving **and** at execution.
   - `GENERATION` and `RECURRING_GENERATION` actions: `DEVELOPER+` regardless of policy.
   - Edit/cancel someone else's action: `DEVELOPER+`. **Take over** (re-own): a user who holds every permission the
     action needs.
   - At execution the M27 engine re-checks the owner through `PublishPermissionEvaluator` (M27 decision "run as
     creator, fail if no longer permitted"): an editor's pending schedule fails after the admin switches the
     permission off.
10. **Policy changes** go through `PUT /projects/{key}/publish-policy` (`PROJECT_ADMIN`). Each change records a
    revision (like members/locales: history, time travel read-only, archived guard applies centrally) and audits
    `PUBLISH_POLICY_SET` with `{before, after}`. `POST /projects/{key}/publish-policy/impact` (read-only, allowed on
    archived projects) returns the pending schedules owned by editors that the proposed policy would make fail, so
    the UI can warn before saving.
11. **Generation attribution and audit.** New column `generation_run.comment` (varchar 500, in `023`); the request's
    comment is stored. `GenerationRunView` gains `comment` and `startedBy {id, displayName}` (`null` for a deleted
    user → "Deleted user" like elsewhere). Audit `GENERATION_STARTED` (detail: runId, mode, targetId, scoped,
    scheduledActionId when started by a schedule), `GENERATION_CANCELLED`, `GENERATION_PROMOTED`.
12. **Effective permissions for the UI.** `ProjectDetail` gains `publishPolicy` (the editor list; every member reads
    it) and `permissions` (the caller's effective `PublishPermission`s). The UI never re-derives the rule from the role.
13. **One UI permission helper.** `ProjectPermissionsStore` (`core/project/`) exposes signals such as
    `canEditContent`, `canEditTemplates`, `canManageMembers`, `canRelease`, `canScheduleRelease`,
    `canIncrementalBuild`, `canFullBuild`, `canPromote`, all folded with `ProjectAccessStore.readOnly`. It replaces the
    ad-hoc `ROLE_RANK`/`roleFor` checks listed in Finding 7. A `403` carrying `permission` refreshes the project detail
    (the policy may have changed under an open app) and shows "You no longer have permission to …".
14. **"Build now" after a release.** A successful release (single or Changes view) offers "Build now" (incremental,
    default target, scoped to nothing) when the caller holds `INCREMENTAL_BUILD`. It is a separate explicit action —
    M27's "release only" rule stands.

## Exit criteria (epic is done when)

- [ ] A project admin switches each toggle on the Generation tab; members see the policy read-only; the change is a
      revision plus a `PUBLISH_POLICY_SET` audit entry, and applies to an editor's **next request** (tested with a
      still-valid access token).
- [ ] With all toggles off, an editor sees no release, schedule, build, cancel or promote control and every such
      endpoint answers `403 SF-API-0403` with `permission`.
- [ ] With `RELEASE` an editor releases/discards/unpublishes; with `SCHEDULE_RELEASE` they schedule one-off
      releases/unpublishes (then-generate only within their build permission); with `INCREMENTAL_BUILD` they start
      incremental runs to the default target and cancel their own; with `FULL_BUILD` full runs to any target.
- [ ] `DEVELOPER+` behaviour is unchanged; promote, target config, `GENERATION` and `RECURRING_GENERATION` schedules
      stay `DEVELOPER+`.
- [ ] An editor's pending schedule fails with "creator no longer permitted" after the permission is switched off, and
      the admin was warned by the impact check first.
- [ ] Runs show `comment` and `startedBy`; start/cancel/promote are audited.
- [ ] The permission matrix test covers every publish-related handler for every role × policy combination.
- [ ] `./gradlew build` (`test --rerun`), `ui` `npm run build` and `npx vitest run` green; the Playwright journey green.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [policy-model](01-policy-model/README.md) | backend | `M27` |
| 2 | [enforcement](02-enforcement/README.md) | backend | 1 |
| 3 | [ui](03-ui/README.md) | frontend | 1, 2 (per task) |
| 4 | [docs-e2e](04-docs-e2e/README.md) | qa | 1–3 |

## Dependencies

`M27` (release/unpublish/discard endpoints, Changes view, `/projects/{key}/schedules`, scheduler engine with the
"re-check the owner at execution" hook, action types `RELEASE`/`UNPUBLISH`/`GENERATION`/`RECURRING_GENERATION`),
`M26` (token epoch, `ProjectAuthorizationService` 404/403 semantics, archived guard, audit service), `M4`/`M22`
(generation runs, targets, dry run).

## Notes

- **API shape.** `GET/PUT /api/v1/projects/{key}/publish-policy`, `POST …/publish-policy/impact`; SpEL
  `@projectAuth.can(#projectKey, 'RELEASE')` for endpoints whose permission doesn't depend on the body; body-dependent
  generation checks happen in one place (`GenerationAuthorization`, decision 7) that the controller and the scheduler
  both call. Regenerate OpenAPI and `ui/src/app/core/api/generated/schema.d.ts` after each backend task.
- **Not in scope:** approval / four-eyes workflow, new roles (e.g. `PUBLISHER`), per-asset or per-folder rights,
  policies for `VIEWER` or for developers, rate limiting of generation starts, email notifications.
- **Spec follow-up (in `M28.4.1`):** §2.1 G1 evidence, §8.3 role table (a "publish policy" row and column note),
  §8.4 (`can`), §18.1 (who may trigger what), §18.5 (`comment`, `startedBy`), §20.2 (new endpoints, changed roles),
  §24 (settings, gated generation screen), §26.3 (new audit actions), Appendix B (`SF-API-0403` `permission`).
