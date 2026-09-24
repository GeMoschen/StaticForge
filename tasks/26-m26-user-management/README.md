# M26 — User management (accounts, admin area, project members, archived projects)

**Spec:** Extends §1 personas (Paul, Ida), §8.1–§8.4 (projects, users, membership, authorization), §9.1–§9.4
(tokens, `tokenEpoch`, endpoints), §19.3 (preview share links), §20.2 (REST catalogue), §23 (`admin/`,
`auth/` features), §24 screen 11 (Admin), §26 (security, audit). Not part of the original §27 roadmap —
inserted the same way `M8`–`M25` were.

## Goal

Today the backend knows users, statuses, system roles and project memberships, but nothing can manage them:
there is no `/users` API, no admin area, no members UI, no sign-out, and the change-password page is not linked
anywhere (user request 2026-09-24). Planning found security gaps along the way (see "Findings").

This milestone delivers:

- **Instance administration** (`INSTANCE_ADMIN`, `/admin`): users (create, edit, rename, disable/enable, unlock,
  reset password, grant/revoke instance admin, revoke sessions, delete = anonymize, memberships), projects
  (all incl. archived, archive/unarchive, member counts) and an instance-wide audit view.
- **Project members** tab in project settings: every member reads it, `PROJECT_ADMIN` adds existing users,
  changes roles, removes members.
- **My account** with a user menu everywhere: profile (display name, username, email), password change,
  "my projects", sign out, sign out everywhere.
- **Onboarding without email:** admin-set or generated temporary passwords with a server-enforced
  "must change password" step, and a configurable password policy.
- **Archived projects** become read-only and are hidden from everyone except instance admins.
- **Security fixes:** roles and memberships revoke immediately (token epoch), the seeded `Admin` can't come back
  after a rename or delete, and it must change its password outside dev/demo/test.

## Findings from planning (2026-09-24)

1. `DevAdminInitializer` has `@Profile({"dev", "demo"})` commented out: `Admin`/`Admin` is seeded in **every**
   profile, re-created whenever no user named `Admin` exists.
2. `ProjectServiceImpl.setMemberRole` / `removeMember` never bump the user's `tokenEpoch`. The access token's
   `projects` and `sysRole` claims are trusted by `SfJwtAuthenticationConverter` and `ProjectAuthorizationService`,
   so a removal or demotion takes effect only when the token expires (≤ 15 min), contradicting §9.2.
3. `AuthService.refresh` issues tokens without checking the user's status (the converter rejects a DISABLED
   user's access token on use, so this is cleanup, not a hole).
4. The UI has no sign-out (`ApiClient.logout()` has no caller) and nothing links to `/account/password`.
5. `ChangePasswordRequest` only requires non-blank; BCrypt silently ignores everything past 72 bytes.
6. `GET /projects/{key}/members` returns every member's email to every `VIEWER`.
7. Archiving a project only sets a flag; nothing reads it except the search indexer.

## Decisions (binding for all tasks — revisit only with the user)

1. **Who manages what.** Only `INSTANCE_ADMIN` creates, edits and deletes accounts and manages system roles.
   `PROJECT_ADMIN` adds **existing** users to their project (user lookup), changes roles and removes members.
   Instance admins hold implicit `PROJECT_ADMIN` everywhere and are **not** listed as members; the members tab
   says so.
2. **Onboarding.** On create and on admin password reset the admin either types a password or lets the server
   generate one (shown once, copyable). `mustChangePassword` defaults to `true` for both. No email, no invite links.
3. **Forced change is server-enforced.** New column `app_user.must_change_password`. While it is `true`, every
   authenticated API call answers **`428 SF-API-0428` "Password change required"**, except exactly
   `GET /auth/me`, `POST /auth/password`, `POST /auth/logout`, `POST /auth/refresh` and
   `GET /auth/password-policy` (profile edits wait until after the change). The converter already loads the user
   per request, so the flag is read from the database, not from a token claim. Changing the password clears it.
4. **Password policy** (`sf.security.password.*`): `min-length` (default `12`) and `require-mixed` (default
   `false`: when `true`, at least one letter and at least one digit or symbol). Always: at most **72 UTF-8 bytes**
   (BCrypt limit), rejected with a clear message rather than truncated. A violation is `400 SF-API-0400` with an
   `errors` list (one message per broken rule, like `PUT /projects/{key}/locales`). Applies to self change, admin create and
   admin reset, never to login (existing passwords keep working). `GET /auth/password-policy` (public) serves
   the rules so the UI can show them.
5. **Delete = anonymize.** Irreversible. New status **`DELETED`**; username → `deleted-user-<id>`, email →
   `deleted-<id>@invalid`, display name → `Deleted user`, password hash, lockout fields and
   `must_change_password` cleared, all memberships removed (one revision per project, like `removeMember`),
   all refresh tokens revoked, epoch bumped. Audit entries whose `user_id` is the user get their target
   rewritten from `user:<name>` to `user:deleted-user-<id>`. The row stays (revisions, audit, `granted_by`
   reference it). Hidden from user lists unless "show deleted"; no action applies to a deleted user.
   The API requires `?confirm=<current username>`.
6. **Disable** blocks login, revokes all refresh tokens and bumps the epoch; memberships stay, so re-enabling
   restores access. Disabled members are shown greyed in member lists and excluded from the member lookup.
7. **Username is editable** by the instance admin and by the user (My account). Uniqueness is checked;
   sessions stay valid (the token subject is the user id). The user's self-service change of username, email
   or password requires the current password; display name does not.
8. **Guard rails.** The last `ACTIVE` instance admin can't be disabled, deleted or demoted
   (`409 SF-DOM-0131`). An admin can't disable, delete or demote themselves (`409 SF-DOM-0132`). No "last project
   admin" rule.
9. **Token epoch bumps** (immediate revocation, §9.2) on: member role set or removed, system role changed,
   disable, delete, admin password reset, admin "revoke sessions", self "sign out everywhere", and
   archive/unarchive (for every member of the project). Rename, profile edits, enable and unlock don't bump.
10. **Sign out everywhere** (My account) revokes **all** refresh-token families including the current one,
    bumps the epoch and returns the user to the login page. Admin "revoke sessions" does the same for another user.
11. **Seeded admin.** `DevAdminInitializer` keeps seeding `Admin`/`Admin` in every profile, but **only when
    `app_user` is empty**. Outside the `dev`, `demo` and `test` profiles the seeded account has
    `mustChangePassword = true`. The commented-out `@Profile` line goes; the Javadoc says what really happens.
12. **Archived projects are read-only and hidden.**
    - Non-admin members: not on the dashboard, and every project API answers `404` like for a non-member.
      Mechanism: `JwtServiceImpl` leaves archived projects out of the `projects` claim, `GET /projects` filters
      them, and archive/unarchive bumps every member's epoch, so `ProjectAuthorizationService` answers 404
      with no extra per-request lookup.
    - Instance admins see archived projects (badge) and open them read-only with a banner.
    - Every write fails with **`409 SF-DOM-0130` "Project is archived"**: centrally in
      `RevisionService.allocate`/`allocateOrJoin`, plus explicit guards on writes that allocate no revision
      (starting/promoting generation runs, creating preview share links, and whatever the endpoint walk in
      `M26.2.1` finds). Existing preview share links stop working (`404`). Published output is untouched.
    - `POST /projects/{key}/unarchive` (instance admin) reverses it.
13. **Emails are private.** Member lists include emails only for `PROJECT_ADMIN` and instance admins; the
    member lookup never returns emails.
14. **Audit actions** (instance-level entries have `project_id = null`): `USER_CREATED`, `USER_UPDATED`,
    `USER_RENAMED`, `USER_DISABLED`, `USER_ENABLED`, `USER_UNLOCKED`, `USER_PASSWORD_RESET`,
    `USER_PASSWORD_CHANGED`, `USER_SYSTEM_ROLE_SET`, `USER_SESSIONS_REVOKED`, `USER_DELETED`; project-level
    `PROJECT_ARCHIVED`, `PROJECT_UNARCHIVED`. The instance audit view lists **all** entries (instance and every
    project) with filters for action, user, project (incl. "instance only") and date range.

## Exit criteria (epic is done when)

- [ ] An instance admin can create a user (typed or generated temporary password, optional initial memberships),
      and that user must set a compliant password before any other API call succeeds.
- [ ] An instance admin can rename, edit, disable/enable, unlock, reset the password of, grant/revoke instance
      admin for, revoke sessions of and delete (anonymize) users; guard rails hold (last active admin, self).
- [ ] Role changes, removals, disable, delete, reset and archive take effect on the **next request** of the affected
      user (proven by tests with a still-valid access token).
- [ ] A project admin manages members from the Members tab; other members see it read-only, without emails.
- [ ] Every user has a user menu (My account, Administration for instance admins, Sign out) and a My account page.
- [ ] An archived project is invisible to non-admin members and read-only for everyone; an endpoint walk proves no
      mutating endpoint accepts a write; unarchive restores it.
- [ ] Instance audit view and admin projects page work with filters and paging.
- [ ] `Admin`/`Admin` is only seeded into an empty user table; forced to change outside dev/demo/test.
- [ ] `./gradlew build` (`test --rerun`), `ui` `npm run build` and `npx vitest run` green; the Playwright journey green.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [accounts](01-accounts/README.md) | backend | `M1` |
| 2 | [archived-projects](02-archived-projects/README.md) | backend | 1.1 |
| 3 | [admin-api](03-admin-api/README.md) | backend | 1.2, 2.1 |
| 4 | [ui](04-ui/README.md) | frontend | 1, 2, 3 (per task) |
| 5 | [docs-e2e](05-docs-e2e/README.md) | qa | 1–4 |

## Dependencies

`M1` (users, JWT, refresh-token families, `tokenEpoch`, `ProjectAuthorizationService`), `M7.3` (audit log, login
rate limiting and lockout), `M4` (generation runs — archived guard), `M3.x` preview share links (`PreviewTokenService`),
the project settings shell (merged tabs, `todo.md` "Project settings — merge tabs").

## Notes

- **API shape.** Admin endpoints live under `/api/v1/admin/**` guarded by `hasAuthority('SYS_INSTANCE_ADMIN')`;
  project-scoped endpoints stay under `/projects/{key}/…` with `@projectAuth`. Regenerate OpenAPI and
  `ui/src/app/core/api/generated/schema.d.ts` after each backend task that changes the API.
- **No `If-Match` on users.** `app_user` has no version column; admin edits are last-write-wins (few admins, low
  contention). Adding optimistic locking is a follow-up, not part of this epic.
- **Not in scope:** email delivery, invite links, self-registration, SSO/OIDC, per-asset rights, user groups,
  avatars, a "last project admin" rule, argon2 migration, deleting projects.
- Spec follow-up (in `M26.5.1`): §8.2 (`DELETED`, `must_change_password`), §8.4 (archived → 404), §9.2 (epoch
  bump list), §9.4 + §20.2 (new endpoints), §23/§24 (admin area, members tab, user menu), §26 (password policy).
