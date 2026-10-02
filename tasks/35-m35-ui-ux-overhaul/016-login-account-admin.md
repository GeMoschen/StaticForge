---
id: M35.16
status: done
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

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

## Acceptance criteria

- [x] Screen definition of done (README) met for every screen listed.
- [x] Vitest specs updated. `npx vitest run` and `npx ng build` green.

## Notes (M35.10)

- Admin and Account already run inside the frame; admin lost its tabs and centering, and the account page lost its
  back link and user menu. Account and dashboard keep their own content layout until this task and M35.28.
- Admin sections are in the rail (Users, Projects, Jobs, Audit) - don't add a second sub-navigation.

## Review (2026-10-02)

Design signed off in the sample first (gate round 6, decisions 61–71). Built as signed off; deviations below.

- **Login / Set password:** `features/auth/*`, `features/account/set-password*` — the centred card, inline errors, show-password toggle, live
  checklist (`password-rules.util.ts` → `checkPassword`, characters not bytes, the limit shown only when exceeded).
- **My account:** `/account/:section` (profile, password, preferences, projects, sessions) with `sf-side-nav`, explicit save + unsaved guard
  (registered as an editor: Ctrl+S, leave dialog, *Unsaved* badge); `/account` and `/account#password` redirect.
- **Administration:** Users (+ detail, New user / Reset password dialog), Projects (New / Edit project dialogs), Jobs (+ detail, run report),
  Audit (multi-select action filter, user combobox, inline date range) on `sf-data-table` with filters in the URL, `twoLine` +
  `sf-table-identity` cells, row ⋮ menus, human role/status/outcome/action labels, skeleton/empty/error states; no `window.confirm`
  left in these screens. `admin-shell` is now a plain container (every page has its own page-header `h1`).
- **Shared:** `sf-table-identity` + `twoLine` and the pointer cursor on openable rows (`rowsOpenable`) in `sf-data-table`;
  `scripts/merge-i18n.py` (and `merge-sample-i18n.py`) for concurrent i18n merges; the i18n key naming rule (lowercase
  `area.sub.key`) is enforced by `i18n.spec.ts`.
- **Checks:** 269 test files / 2,368 tests, `ng build` and `npm run lint` green (lint baselines updated: 112 screen files left); checked in
  Chrome / headless Playwright against the dev backend.
- **Deviations from the sample (all because the app differs):** no "Release manager" role (the app's roles are Viewer, Editor, Developer,
  Project admin); Set password keeps a *Temporary password* field (the API needs the current password); the job schedule form keeps the
  real cron field, time-zone combobox and typed settings instead of the sample's frequency/time form; schedule phrases and durations
  still come from the English helpers in `admin-jobs.util.ts` (runtime-built, the i18n lint only checks templates); the create-user
  dialog has no first-memberships rows; deleting a user has no Undo (the API cannot restore one).
- **Open:** the admin job schedule/duration helpers could move to Transloco keys; the legacy password-rule helpers were removed.
