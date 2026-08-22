# Feature: Auth UI

**Spec:** §23.3 (auth handling).
**Area:** frontend. **Epic:** M3.

## Goal

Implement login, token storage (signal-only, never localStorage), the JWT/refresh/ETag
interceptors, and route guards.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-auth-store-login-guards.md](001-auth-store-login-guards.md) | M1.2.2 |
| 2 | [002-interceptors.md](002-interceptors.md) | 1 |

## Feature exit criteria

- [ ] Login persists no token to `localStorage`; refresh is single-flight with retry.
- [ ] `authGuard` + `projectMemberGuard(minRole)` gate routes using decoded token roles
      (§23.3).

## Dependencies

`M1:auth` (endpoints exist).
