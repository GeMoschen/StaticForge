---
id: M26.5.1
status: done
depends: [M26.1.2, M26.1.3, M26.2.1, M26.3.1]
epic: m26-user-management
feature: docs-e2e
area: qa
---

# M26.5.1 — Spec and docs

## Context

`cms-specification.md`, `infra/README.md`, `docs/` (architecture, admin/operator notes). Epic "Spec follow-up" list.

## Goals

- Spec: §8.2 (`DELETED`, `must_change_password`, anonymization), §8.1/§8.4 (archived: hidden → 404, read-only
  `SF-DOM-0141`), §9.2 (the full epoch-bump list), §9.4 + §20.2 (admin, self-service, lookup, unarchive, audit
  endpoints), §23/§24 (admin area, members tab, user menu, My account), §26 (password policy, audit actions).
- `infra/README.md`: `sf.security.password.*` keys, the seeded `Admin`/`Admin` rule (empty table only; forced change
  outside dev/demo/test) and what an operator does first in prod.
- A short admin guide (`docs/administration.md`): creating users, temporary passwords, disable vs delete, unlock,
  archive.

## Acceptance criteria

- [x] Every new endpoint appears in §20.2 with its role; every new error code is listed where codes are documented.
- [x] `infra/README.md` environment/config tables updated.
- [x] Docs reviewed against the implemented behaviour (not the plan) — deviations recorded in the task notes.

## Out of scope

- Code changes.

## Implementation notes

- Spec: §8.1 (archived projects, what still works), §8.2 (statuses incl. `LOCKED`/`DELETED`, anonymization, username
  rules, forced change + allowlist, password policy, seeded admin, guard rails), §8.3 (who manages what, private
  emails), §8.4, §9.1/§9.2 (`epoch` claim, the full bump list, which actions also end sessions, bearer ignored on
  login/refresh), §9.4, §20.2 (projects + new *Users and administration* table), §23.2/§23.3 (effective role, forced
  change), §24.5 (screens 11–13), §26.3 (auth and audit rows), Appendix B (`SF-API-0423`, `SF-API-0428`,
  `SF-DOM-0131`, `SF-DOM-0132`).
- `docs/api.md` (auth, members, lookup, admin users, error codes), `infra/README.md` (*First sign-in and accounts*,
  *Configuration properties*), new `docs/administration.md`, `docs/user-guide.md` (*Your account and project members*).

**Deviations found while checking against the code (the docs describe the code):**

- §9.2 said revocation compares the token's `iat` with the epoch; the code carries an `epoch` claim and compares it
  with `app_user.token_epoch`.
- §8.4 named a `ProjectAccessDeniedException`; the code throws an `SfException` with a `403` problem.
- The own password change also bumps the epoch and drops every refresh-token family (not in the epic's decision 9 list,
  implemented that way since M26.1.3); the client signs in again.
- A `LOCKED` account keeps its current session: the lock only blocks sign-in (the converter refuses `DISABLED` and
  `DELETED` only).
- `SF-API-0423` (account locked) existed in code and `docs/api.md` but not in Appendix B — added.
- The project-level audit (`GET /projects/{key}/audit`) has no UI; documented as API-only.
- Audit retention ("1 year", §26.3) is not enforced: no purge job.
