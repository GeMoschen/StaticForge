# Feature: Accounts — account model, session rules, user admin API, self-service API

**Spec:** Extends §8.2 (users), §8.3 (membership), §9.2/§9.4 (tokens, endpoints), §20.2, §26 (password policy, audit).

## Goal

Give the account model what management needs (`DELETED`, `must_change_password`, a password policy), make every
role or access change take effect on the next request, and expose the instance-admin user API, the member lookup
for project admins and the self-service account API.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-account-model-and-session-rules.md](001-account-model-and-session-rules.md) | — |
| 2 | [002-user-admin-api.md](002-user-admin-api.md) | 1 |
| 3 | [003-self-service-account-api.md](003-self-service-account-api.md) | 1 |

Tasks 2 and 3 touch different controllers but share `UserService`; run them sequentially in the backend lane.

## Feature exit criteria

- [ ] `DELETED` status, `must_change_password` and the configurable password policy exist; `428 SF-API-0428` is
      enforced with the exact allowlist.
- [ ] Membership changes, system-role changes, disable, delete and resets revoke immediately (epoch bump).
- [ ] `/api/v1/admin/users/**` covers list, detail, create, edit, rename, disable/enable, unlock, reset password,
      system role, revoke sessions, delete (anonymize); `GET /users/lookup` serves project admins.
- [ ] `/auth/me` (read + `PATCH`), `/auth/password`, `/auth/sessions/revoke`, `/auth/password-policy` work.
- [ ] Seeded `Admin` only into an empty user table.

## Dependencies

`M1.2.*` (auth, JWT, refresh-token families), `M7.3` (audit, lockout).
