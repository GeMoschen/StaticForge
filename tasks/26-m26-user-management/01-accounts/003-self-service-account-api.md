---
id: M26.1.3
status: done
depends: [M26.1.1]
epic: m26-user-management
feature: accounts
area: backend
---

# M26.1.3 — Self-service account API (profile, password, sign out everywhere)

## Context

`AuthController` (`/api/v1/auth`), `AuthService`, `UserService`, `RefreshTokenService`, `RefreshCookieService`.
Epic decisions 4, 7, 9, 10.

## Goals

- `GET /auth/me` returns id, username, displayName, **email**, systemRole, **mustChangePassword**, and
  **memberships** `[{projectKey, projectName, role}]` (archived projects excluded unless instance admin — use the
  same rule as `GET /projects`).
- `PATCH /auth/me` `{displayName?, username?, email?, currentPassword?}` — `currentPassword` is required when
  `username` or `email` changes (`400` otherwise, `401`-free: wrong password is `400 "Current password is
  incorrect."` like today's password change). Uniqueness `409`. Audit `USER_UPDATED` / `USER_RENAMED` with the user
  as actor.
- `POST /auth/password` applies `PasswordPolicy`; keeps today's epoch bump + revoke all (the UI re-logs in or
  refreshes as today — verify which and keep it working).
- `POST /auth/sessions/revoke` — revokes **all** refresh-token families including the current one, bumps the epoch,
  clears the refresh cookie (`204`); audit `USER_SESSIONS_REVOKED`.
- `GET /auth/password-policy` (public, `permitAll`) → `{minLength, requireMixed, maxBytes: 72}`.
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [x] API tests: profile edit with/without password, wrong password, duplicate username/email, display-name-only
      edit without password.
- [x] After `sessions/revoke`, the old access token and the old refresh cookie are both rejected.
- [x] `password-policy` reachable without a token and reflects configured values.
- [x] Password change enforces the policy (`400 SF-API-0400` with `errors`).
- [x] `./gradlew build` green.

## Out of scope

- UI (`M26.4.1`).

## Notes / hazards

- `SecurityConfig` must add `permitAll` for `/api/v1/auth/password-policy` next to the existing public auth routes.
- A username change does not bump the epoch: the token's `preferred_username` is stale until the next refresh; the
  UI reloads `/auth/me` after saving instead of reading the claim.

## Implementation notes

- `/auth/me` keeps `projectRoles` (the UI `AuthStore` reads it) next to the new `email`, `mustChangePassword` and
  `memberships`; `displayName` is the stored value (`null` when unset), no longer the username fallback.
- `POST /auth/password` still revokes every session: verified that the UI's next call gets `401`, its refresh fails
  and it routes to the login page (`refresh.interceptor.ts`). Kept as is; M26.4 may want to route explicitly.
