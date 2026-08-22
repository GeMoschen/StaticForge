# Feature: Projects, users & memberships

**Spec:** §8 (project/user/member models, roles), §20.2 (Projects + members endpoints).
**Area:** backend. **Epic:** M1.

## Goal

Model and expose projects, users, and per-project membership with the four roles, the
isolation guarantee, and the authorization service used everywhere else.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-user-project-membership-entities.md](001-user-project-membership-entities.md) | M0.3.2 |
| 2 | [002-project-service-authorization.md](002-project-service-authorization.md) | 1 |
| 3 | [003-project-member-api.md](003-project-member-api.md) | 2 |

## Feature exit criteria

- [ ] `project`, `app_user`, `project_member` entities + repositories exist per §8.
- [ ] `ProjectAuthorizationService.has(projectKey, minRole)` enforces role ordinals and
      hides non-visible projects (404 vs 403, §8.4).
- [ ] Project/membership REST endpoints work with `VIEWER`/`PROJECT_ADMIN`/`INSTANCE_ADMIN`
      gating and `Idempotency-Key` on creates.

## Dependencies

`M0:database-liquibase` (schema harness), `M0:backend-bootstrap` (security skeleton).
