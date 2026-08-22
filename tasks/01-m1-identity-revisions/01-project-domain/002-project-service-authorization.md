---
id: M1.1.2
status: done
depends: [M1.1.1]
epic: m1-identity-revisions
feature: project-domain
area: backend
---

# M1.1.2 — ProjectService & ProjectAuthorizationService

## Context

Encode the role model (§8.3) and the request-scoped authorization resolution (§8.4)
that every later endpoint depends on.

## Goals

- Implement `ProjectService` (create/archive/update project, revision-1 creation hook
  will be wired when `revision` feature lands) and `ProjectAuthorizationService.has(key,
  minRole)`.
- Model the role ordinal (§8.3 table): VIEWER < EDITOR < DEVELOPER < PROJECT_ADMIN, plus
  the `INSTANCE_ADMIN` implicit `PROJECT_ADMIN` everywhere and `onBehalf` recording.
- Cache membership per request (ThreadLocal/request scope) and implement the 404-vs-403
  rule: no read at all → `404`, insufficient role → `403` problem document (§8.4).
- Add the `@PreAuthorize("@projectAuth.has(#projectKey, 'DEVELOPER')")` support bean.

## Acceptance criteria

- [ ] A non-member gets `404` (project existence not leaked); a `VIEWER` calling an
      editor-only op gets `403` with `SF-API-0403`.
- [ ] Role ordinal comparison is correct for all four roles.
- [ ] `INSTANCE_ADMIN` bypasses project membership and records `onBehalf` in revision
      summaries (stubbed until revision exists).

## Out of scope

- Actual JWT claims → role resolution (auth feature supplies `projects` map).

## Notes / hazards

- Keep authorization free of DB hits per call via the request-scoped cache.
