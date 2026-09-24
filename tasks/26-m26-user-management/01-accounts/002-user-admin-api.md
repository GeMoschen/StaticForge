---
id: M26.1.2
status: todo
depends: [M26.1.1]
epic: m26-user-management
feature: accounts
area: backend
---

# M26.1.2 — User admin API, member lookup, private member emails

## Context

New `AdminUserController` under `/api/v1/admin/users` (`hasAuthority('SYS_INSTANCE_ADMIN')`), `UserService`,
`ProjectService` (memberships), `AuditService`, `RefreshTokenService.revokeAll`. Epic decisions 1, 2, 5–9, 13, 14.

## Goals

- **List** `GET /admin/users?q=&status=&systemRole=&includeDeleted=false&page=&size=&sort=` — server-side paging
  (default sort username), `q` matches username, email and display name (case-insensitive). Row: id, username,
  displayName, email, status, systemRole, mustChangePassword, lastLoginAt, projectCount.
- **Detail** `GET /admin/users/{id}` — row fields plus createdAt, failedLogins, lockedUntil, memberships
  (projectKey, projectName, archived, role, grantedAt, grantedBy username).
- **Create** `POST /admin/users` `{username, email, displayName?, systemRole, password? | generatePassword: true,
  mustChangePassword = true, memberships?: [{projectKey, role}]}` → `201` with the detail and, when generated,
  `generatedPassword` (returned only in this response). Policy applies to a typed password; generated passwords are
  16 characters from a secure random source and always satisfy the policy. Memberships go through
  `ProjectService.setMemberRole` (one revision per project) in the same transaction.
- **Edit** `PATCH /admin/users/{id}` `{username?, email?, displayName?}` — uniqueness checks (`409`), rename audited
  as `USER_RENAMED` (old → new), the rest as `USER_UPDATED`.
- **Actions:** `POST /admin/users/{id}/disable`, `/enable`, `/unlock` (clears lock, failed logins, `LOCKED` →
  `ACTIVE`), `/revoke-sessions`, `/password` `{password? | generatePassword, mustChangePassword = true}` (revokes
  sessions), `PUT /admin/users/{id}/system-role` `{systemRole}`.
- **Delete** `DELETE /admin/users/{id}?confirm=<username>` — anonymize exactly as epic decision 5; `400` when
  `confirm` doesn't match.
- **Guard rails** (decision 8): last `ACTIVE` instance admin → `409 SF-DOM-0131`; self disable/delete/demote →
  `409 SF-DOM-0132`. No action on a `DELETED` user (`409`).
- **Epoch/sessions:** disable, delete, reset, system role and revoke-sessions bump the epoch and revoke all refresh
  tokens (decision 9).
- **Member lookup** `GET /users/lookup?projectKey=&q=` — caller must be `PROJECT_ADMIN` of `projectKey` (or instance
  admin); returns at most 20 `ACTIVE`/`LOCKED` users `{id, username, displayName, member: boolean}`, never emails.
- **Members view:** `ProjectMemberView` gains `status`; `email` is `null` unless the caller is `PROJECT_ADMIN`
  or instance admin (decision 13). Adding a member who is `DISABLED`/`DELETED` is `409`.
- **Audit** every action (decision 14), actor = acting admin, `project_id` null.
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [ ] API tests per endpoint: happy path, `403` for a non-admin, validation (`400` policy errors, `409` duplicates).
- [ ] Create with generated password returns it once; the user must change it (`428`) and can log in with it.
- [ ] Create with memberships: user has the roles, one revision per project, audit entries written.
- [ ] Delete anonymizes every field listed in decision 5, removes memberships, rewrites the user's audit targets,
      and a login with the old username fails; the row still resolves in revision history as `Deleted user`.
- [ ] Guard rails: last active admin and self actions rejected with the right codes; a second admin can do it.
- [ ] A still-valid token of a disabled/deleted/reset/demoted user is rejected on the next request.
- [ ] Lookup: `403`/`404` for a non-admin of the project, no emails, excludes disabled/deleted, flags members.
- [ ] Members list hides emails for `VIEWER`..`DEVELOPER`, shows them for `PROJECT_ADMIN` and instance admins.
- [ ] `./gradlew build` green.

## Out of scope

- Self-service (`M26.1.3`), admin projects and audit endpoints (`M26.3.1`), UI.

## Notes / hazards

- Anonymize must not break `unique` constraints: `deleted-user-<id>` / `deleted-<id>@invalid` are unique by id.
- The audit rewrite touches only rows with `user_id = id` (their target may carry an *earlier* username after a
  rename); failed logins for unknown usernames have no `user_id` and stay.
- Revision/history views that show a user's name must render `Deleted user` for `DELETED` — check the revision list
  and spine DTOs, which may read `username` directly.
