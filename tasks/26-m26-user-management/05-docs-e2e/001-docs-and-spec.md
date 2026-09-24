---
id: M26.5.1
status: todo
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
  `SF-DOM-0130`), §9.2 (the full epoch-bump list), §9.4 + §20.2 (admin, self-service, lookup, unarchive, audit
  endpoints), §23/§24 (admin area, members tab, user menu, My account), §26 (password policy, audit actions).
- `infra/README.md`: `sf.security.password.*` keys, the seeded `Admin`/`Admin` rule (empty table only; forced change
  outside dev/demo/test) and what an operator does first in prod.
- A short admin guide (`docs/administration.md`): creating users, temporary passwords, disable vs delete, unlock,
  archive.

## Acceptance criteria

- [ ] Every new endpoint appears in §20.2 with its role; every new error code is listed where codes are documented.
- [ ] `infra/README.md` environment/config tables updated.
- [ ] Docs reviewed against the implemented behaviour (not the plan) — deviations recorded in the task notes.

## Out of scope

- Code changes.
