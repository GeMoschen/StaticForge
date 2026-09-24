---
id: M26.1.1
status: done
depends: []
epic: m26-user-management
feature: accounts
area: backend
---

# M26.1.1 — Account model, password policy, forced change, immediate revocation, admin seeding

## Context

`sf-domain` `user/` (`AppUser`, `UserStatus`, `UserService`, `PasswordService`), `sf-api` `security/`
(`AuthService`, `SfJwtAuthenticationConverter`, `JwtServiceImpl`, `RefreshTokenService`, `LoginAttemptService`),
`ProjectServiceImpl.setMemberRole/removeMember`, `sf-app` `bootstrap/DevAdminInitializer`. Epic decisions 3, 4,
5 (status only), 9, 11 and findings 1–3, 5.

## Goals

- **Schema** (new changelog `019-user-management.xml`, H2 + PostgreSQL): `app_user.must_change_password boolean
  not null default false`. `status` gains the value `DELETED` (`UserStatus.DELETED`; the column is `varchar(30)`, no
  DDL needed beyond what the enum requires — check for a CHECK constraint).
- **Password policy.** `PasswordPolicy` (domain) + `@ConfigurationProperties("sf.security.password")` with
  `min-length` (default 12) and `require-mixed` (default false); always max 72 UTF-8 bytes. `validate(raw)` returns
  every broken rule as a message. Used by self change, admin create and admin reset (later tasks call it);
  a violation is `400 SF-API-0400` with `errors`. Add both keys (commented defaults) to `application.yml`.
- **Forced change.** `UserService.changePassword` clears `must_change_password`. A filter after bearer
  authentication answers `428 SF-API-0428` ("Password change required") for every authenticated request except
  `GET /auth/me`, `POST /auth/password`, `POST /auth/logout`, `POST /auth/refresh`, `GET /auth/password-policy`.
  `GET /auth/me` gains `mustChangePassword`.
- **Immediate revocation.** One domain method, e.g. `UserService.revokeAccess(userId)` (bump epoch), used by
  `setMemberRole`, `removeMember` and every later path from decision 9. `AuthService.refresh` rejects users whose
  status is `DISABLED` or `DELETED` (`401`, family revoked).
- **Status handling.** Login and the converter treat `DELETED` like `DISABLED`. `LOCKED` keeps today's
  behaviour (lock expires after 30 min or on admin unlock).
- **Seeding.** `DevAdminInitializer` seeds `Admin`/`Admin` only when `app_user` has **no rows**; outside the `dev`,
  `demo` and `test` profiles it sets `must_change_password = true`. Remove the commented `@Profile`; the Javadoc
  states the rule. The seeded password bypasses the policy by design (the forced change applies it).
- **Audit:** `USER_PASSWORD_CHANGED` on self change (instance-level).

## Acceptance criteria

- [x] Changelog applies on H2; `ddl-auto: validate` passes.
- [x] `PasswordPolicy` unit tests: min length, `require-mixed` on/off, 72-byte limit with multi-byte characters,
      several broken rules reported together.
- [x] Integration: a user with `must_change_password` gets `428 SF-API-0428` on a project endpoint and on
      `PATCH /auth/me`, succeeds on each allowlisted endpoint, and after `POST /auth/password` reaches the project.
- [x] Integration with a **still-valid access token**: after `setMemberRole` (downgrade) and `removeMember`, the
      next request with the old token is `401` (stale epoch); after refresh the new role applies.
- [x] Refresh of a disabled user fails and revokes the family.
- [x] Seeder: seeds into an empty table; seeds nothing when any user exists (e.g. `Admin` renamed); prod-like
      profile sets `must_change_password`, `dev`/`test` don't.
- [x] `./gradlew build` green.

## Out of scope

- Admin endpoints (`M26.1.2`), self-service profile editing (`M26.1.3`), archive (`M26.2.1`).

## Notes / hazards

- Bumping the epoch invalidates the **acting** user's token too when they change their own membership (a project
  admin removing themselves). The UI refreshes on `401` already; verify it does not end in a logout loop.
- Tests that rely on the seeded `Admin` in the `test` profile keep working because each test DB starts empty; check
  fixtures that create users *before* the runner fires (`CommandLineRunner` order).
- Lessons "default interface method is not behind the Spring proxy": new `@Transactional` overloads are abstract.

## Implementation notes

- The epoch bump is `UserService.revokeAccess(userId)` (renamed from `bumpTokenEpoch`).
- `JwtServiceImpl.issueAccessToken` now reads every claim, `epoch` included, from the account's current row: a
  caller holding an entity loaded before a membership change would otherwise issue a token that is dead on arrival.
- `/auth/me` reads `mustChangePassword` from the account row (the converter loads it per request; it is on
  `AuthenticatedUser`, never in a claim). `PasswordChangeRequiredFilter` is not a bean on purpose (it would also be
  registered on the servlet container); `SecurityConfig` adds it after `BearerTokenAuthenticationFilter`.
- Self-removal hazard verified: a project admin removing themselves gets `401` on the next call and a working token
  from `/auth/refresh` (`AccountSessionRulesIntegrationTest`).
