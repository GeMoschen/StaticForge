---
id: M28.1.1
status: done
depends: []
epic: m28-editor-publishing
feature: policy-model
area: backend
---

# M28.1.1 — Publish policy: model, evaluation rule and API

## Context

`Project` (`sf-domain/.../project/Project.java`: `allowed_mime_types`, `locale_config` JSON), `ProjectServiceImpl`,
`ProjectController` (`PUT /projects/{key}`, `PUT /projects/{key}/locales` — pattern for a settings endpoint that
records a revision), `ProjectDetail` DTO, `ProjectAuthorizationService` (`has`, `role`), `ProjectRole.atLeast`,
`ProjectMemberRepository`, `AppUser` (status, system role), `AuditService.record`, `RevisionService.allocate` (archived
guard). Requires M27 merged. Epic decisions 1–5, 10, 12.

## Goals

- **Schema.** Changelog `v1.0/023-publish-policy.xml`: `project.publish_policy` JSON, not null, default
  `{"editor":[]}` for every existing row (H2 + PostgreSQL). (The same changelog gets `generation_run.comment` in
  `M28.2.2` — one file per epic.)
- **Model** (sf-domain, `project/publish/`): `PublishPermission { RELEASE, SCHEDULE_RELEASE, INCREMENTAL_BUILD,
  FULL_BUILD }`; value object `PublishPolicy(Set<PublishPermission> editor)` with
  - `validate()` → list of broken implication rules (`SCHEDULE_RELEASE` needs `RELEASE`, `FULL_BUILD` needs
    `INCREMENTAL_BUILD`), unknown names rejected on deserialization;
  - `grants(ProjectRole role, PublishPermission p)` — the **single** rule: `VIEWER` → false, `EDITOR` → `p ∈ editor`,
    `DEVELOPER`/`PROJECT_ADMIN` → true;
  - `effective(ProjectRole role)` → the set.
- **Domain evaluator** `PublishPermissionEvaluator.permitted(long projectId, long userId, PublishPermission p)`: user
  must be `ACTIVE` (a `DISABLED`/`DELETED` user holds nothing); `INSTANCE_ADMIN` → true; otherwise role from the
  **membership row** (none → false) and `grants`. Also `hasRole(projectId, userId, ProjectRole min)` for role-only
  checks the scheduler needs. Archived projects: no special case here (the scheduler doesn't run them, M27).
- **Request-side check** `ProjectAuthorizationService.can(String projectKey, PublishPermission p)`: 404 for
  non-members (same as `has`), instance admin → true, else role from the token + policy read from the project row
  **per call** (no cache, decision 4) → `true` or `403 SF-API-0403` with problem extension
  `permission: "<NAME>"`. Accept the permission as a string too so SpEL can write
  `@projectAuth.can(#projectKey, 'RELEASE')`; an unknown name is a programming error (500 at startup-time test, see
  acceptance). Add `permissions(projectKey)` returning the effective set for the caller.
- **API.**
  - `GET /projects/{key}/publish-policy` (`VIEWER`): `{editor: [...]}`.
  - `PUT /projects/{key}/publish-policy` (`PROJECT_ADMIN`): body `{editor: [...]}`; `400 SF-API-0400` with `errors`
    (one message per broken rule); identical policy → `200`, no revision, no audit. Otherwise one revision (summary
    entry `PROJECT` / `publishPolicy`, like the locales change) and audit `PUBLISH_POLICY_SET`
    (target `project:<key>`, detail `{before, after}`).
  - `POST /projects/{key}/publish-policy/impact` (`PROJECT_ADMIN`, `@AllowedOnArchivedProject("read-only impact
    check")`): body = proposed policy; returns `{failingSchedules: [{id, type, runAt, ownerUserId, ownerName,
    missingPermission}]}` — pending M27 schedules whose owner is an `EDITOR` and would lose a permission the action
    needs (use the M27 handler SPI's `requirements(params)` (incl. the "then generate" build), decision 9).
  - `ProjectDetail` gains `publishPolicy` (object above) and `permissions` (the caller's effective set, sorted).
- Regenerate OpenAPI and `ui/src/app/core/api/generated/schema.d.ts`.

## Acceptance criteria

- [x] Migration: existing projects read `{"editor":[]}`; a new project starts empty; H2 and PostgreSQL changelog
      checks green.
- [x] Unit test: `grants` for every role × permission × policy subset (table-driven); `validate` messages for both
      implications and for both together.
- [x] `can` and `permitted` agree on a shared fixture matrix (same role, same policy → same answer); a `DISABLED`
      member with a valid token is already rejected upstream (M26) — `permitted` returns false for them.
- [x] **Next request:** an editor with a still-valid access token gets `403` before and `2xx` after the admin enables
      `RELEASE` (use a trivial guarded test endpoint or the first M28.2.1 endpoint), with no token refresh.
- [x] `PUT` records a revision + `PUBLISH_POLICY_SET`; no-op `PUT` records neither; `PUT` on an archived project is
      `409 SF-DOM-0141`; `PUT` as `DEVELOPER` is `403`.
- [x] `impact` lists exactly the editor-owned pending schedules that would fail (fixture with one `RELEASE` schedule,
      one with "then generate" to a non-default target, one owned by a developer).
- [x] A test asserts every `@projectAuth.can(…, '<NAME>')` literal in `@PreAuthorize` annotations names an existing
      `PublishPermission` (scan handler methods at context start).
- [x] Regenerated `schema.d.ts` committed; `./gradlew build` green.

## Out of scope

- Guarding the actual endpoints (`M28.2.1`, `M28.2.2`), UI (`M28.3.x`).

## Notes / hazards

- `ProjectAuthorizationService` lives in sf-api and must not grow a DB dependency beyond a repository/service call
  for the policy — put the policy read behind `ProjectService.publishPolicy(projectKey)` in sf-domain.
- Don't cache the policy in the token or in a bean: "applies on the next request" is the acceptance test. If a
  cache is ever added it needs eviction on write *and* multi-node invalidation — out of scope.
- Keep `has(...)` untouched; `can(...)` is additive. Lesson "no `default` interface methods delegating to proxied
  behaviour" applies if `ProjectService` gains overloads.
- The policy is authorization config, but it is a revisioned project setting on purpose (history, time travel shows
  the policy as of R read-only, archived guard). Time travel must not *evaluate* permissions at R — enforcement
  always uses the current policy.
