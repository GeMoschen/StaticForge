# Feature: UI — user menu, My account, admin area, members tab, archived projects

**Spec:** Extends §23 (`auth/`, `admin/` features), §24 screen 11 (Admin), §24 editor UX (read-only states).

## Goal

Every user can reach their account and sign out; instance admins manage users, projects and read the audit log
in `/admin`; project admins manage members in project settings; archived projects look and behave read-only.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-user-menu-and-my-account.md](001-user-menu-and-my-account.md) | `M26.1.1`, `M26.1.3` |
| 2 | [002-admin-users.md](002-admin-users.md) | `M26.1.2`, 1 |
| 3 | [003-project-members-tab.md](003-project-members-tab.md) | `M26.1.2` |
| 4 | [004-admin-projects-audit-and-archived-mode.md](004-admin-projects-audit-and-archived-mode.md) | `M26.2.1`, `M26.3.1`, 2 |

Task 3 can run in parallel with 1–2 (different feature folders).

## Feature exit criteria

- [ ] User menu in the dashboard header and project nav rail; sign out works; forced password change can't be skipped.
- [ ] `/admin/users`, `/admin/projects`, `/admin/audit` behind an instance-admin guard.
- [ ] Members tab in project settings, editable for project admins only.
- [ ] Archived projects: banner, every edit control disabled, hidden from non-admin dashboards.
- [ ] `npm run build` and `npx vitest run` green.

## Dependencies

`M26.1.*`, `M26.2.1`, `M26.3.1` (API + regenerated `schema.d.ts`); `features/dashboard` (dashboard, nav rail,
project shell), `features/auth` (login, password change), `features/settings` (settings shell), `core/auth`
(`AuthStore`, `auth.guard`, `refresh.interceptor`).
