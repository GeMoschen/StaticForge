---
id: M35.16
status: todo
depends: [M35.10, M35.13]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.16 — Login, account and admin screens

## Context

`features/auth/*`, `features/account/*`, `features/admin/*` (users, user detail, projects, jobs, job detail, audit).
Screenshots 01, 90–95, M0, M8 of the UX run. Screen definition of done in the README applies.

## Goals

- **Login:**
  - A centered card with the product mark and name, styled inputs, and a primary button whose disabled state is clear.
  - Errors are inline.
  - Remove implementation text ("Tokens are kept in memory only").
  - Set-password screen gets the same style.
- **Account:**
  - Sections: Profile, Password, Preferences, My projects, Sessions.
  - Preferences shows theme, density, developer mode, and the language (English only).
  - Password rules shown as a live checklist that isn't "satisfied" while empty, in plain language (no "72 bytes"
    wording; show the length limit in characters, and explain it only when exceeded).
- **Admin:**
  - Runs in the frame (M35.10).
  - Users, Projects, Jobs and Audit use `sf-data-table`, with filters in the URL.
  - Audit uses a multi-select combobox instead of a native listbox, an inline date range, and human action labels
    (`enum.*`).
  - Consistent time display (`sf-relative-time`).
  - User detail: one danger action per menu. Disable is secondary; Delete is in an overflow menu with a typed
    confirmation.
  - Every `window.confirm` is replaced.
  - Roles appear as human labels ("Project admin"), never raw enums.

## Acceptance criteria

- [ ] Screen definition of done (README) met for every screen listed.
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.
