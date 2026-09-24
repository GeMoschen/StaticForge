---
id: M26.4.2
status: todo
depends: [M26.1.2, M26.4.1]
epic: m26-user-management
feature: ui
area: frontend
---

# M26.4.2 — Admin area shell and user management

## Context

New `features/admin` (spec §23 `admin/`: users, projects, members). Admin API from `M26.1.2`. Existing shared
building blocks: `sf-button`, `sf-field`, dialogs (`sf-create-asset-dialog` pattern), paged grids
(`record-grid.component`). Epic decisions 1, 2, 5–8.

## Goals

- **Shell** `/admin` (outside any project, instance-admin guard → dashboard otherwise) with tabs Users · Projects ·
  Audit (Projects/Audit are filled by `M26.4.4`; until then the tabs are hidden, not dead).
- **Users list** `/admin/users`: server-side paged table (username, display name, email, status chip, instance-admin
  badge, "must change password" hint, last login, project count), search box (debounced), status and role filters,
  "Show deleted" toggle; row click opens the detail.
- **Create user** dialog: username, email, display name, "Instance administrator" checkbox, password mode
  ("Generate" default / "Set password" with policy checks), "Must change password at first login" (default on),
  optional project rows (project picker from all non-archived projects + role). On success with a generated password,
  a one-time panel shows it with a copy button and a warning that it won't be shown again.
- **User detail** `/admin/users/:id`: profile form (username, email, display name; dirty-gated save); account panel
  (status, created, last login, failed logins, locked until); actions with confirmations: Disable/Enable, Unlock
  (only when locked), Reset password (same generate/set + must-change UI, generated password shown once), Revoke
  sessions, Grant/Revoke instance admin, Delete user (dialog requires typing the username, explains anonymization and
  that it is irreversible). Actions blocked by guard rails are disabled with the reason (self, last active admin);
  server `409 SF-DOM-0131/0132` still shown if it happens.
- **Memberships** section on the detail: list (project, role, granted at/by), add (project + role), change role,
  remove — using the existing `/projects/{key}/members` endpoints.
- Deleted users open read-only ("Deleted user", no actions).

## Acceptance criteria

- [ ] Vitest specs: guard, list query params (paging, search debounce, filters, show deleted), create payloads for
      both password modes with and without memberships, one-time password panel, detail action enablement per
      status/self/last-admin, delete confirmation matching, membership add/change/remove.
- [ ] Manual check in the running app: create a user with a generated password and a membership, log in as them
      (forced change), disable and re-enable, delete.
- [ ] `npm run build` green; bundle budget note if the eager bundle grows (lazy-load `features/admin`).

## Out of scope

- Admin projects and audit pages (`M26.4.4`).

## Notes / hazards

- Lazy-load the admin feature route: it's only for instance admins and should not grow the eager bundle
  (M25 raised the budget already).
- The generated password must never be kept in a store or logged; clear it when the panel closes.
