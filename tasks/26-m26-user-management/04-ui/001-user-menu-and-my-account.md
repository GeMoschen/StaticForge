---
id: M26.4.1
status: done
depends: [M26.1.1, M26.1.3]
epic: m26-user-management
feature: ui
area: frontend
---

# M26.4.1 — User menu, sign out, My account, forced password change

## Context

`features/dashboard` (`dashboard.component` header, `nav-rail.component`, `project-shell.component`),
`features/auth` (`login.component`, `password-change.component` — routed at `account/password`, linked from
nowhere), `core/auth` (`AuthStore`, `auth.guard`, `refresh.interceptor`), `ApiClient.logout()` (no caller today).
Epic decisions 3, 4, 7, 10.

## Goals

- **User menu** (shared component) in the dashboard header and at the bottom of the project nav rail (collapsed
  rail: avatar initials only): display name + username, "My account", "Administration" (instance admins only →
  `/admin`), "Sign out" (calls logout, clears `AuthStore`, navigates to `/login`).
- **My account** (`/account`): profile form (display name; username and email with a "current password" field
  that appears once either changes), password change section (moved from `password-change.component`, with the
  policy from `GET /auth/password-policy` shown as live rule checks), "My projects" list (project name, role, link),
  "Sign out everywhere" with confirmation (→ `POST /auth/sessions/revoke` → login page). `/account/password`
  redirects to `/account#password`.
- **Forced change.** When `/auth/me` says `mustChangePassword` (after login, on app start, or on any `428
  SF-API-0428` from an interceptor), route to a dedicated full-page "Set a new password" screen
  (`/account/set-password`) that only offers the password form and "Sign out". A guard keeps every other route
  unreachable until the change succeeds; afterwards continue to the originally requested URL.
- Save gated on dirty + valid (lessons "Save button"); server field errors shown inline; `409` duplicates on the
  right field.

## Acceptance criteria

- [x] Vitest specs: menu items per system role, sign-out flow, profile form (password field appears only for
      username/email changes; dirty gating), policy rule checks, forced-change guard + 428 interceptor redirect and
      return URL, sign out everywhere.
- [x] Spec fixtures built from `schema.d.ts` shapes (lessons "Spec fixtures must have the API's real shape").
- [x] Manual check in the running app: log in, open My account from the dashboard and from a project, change display
      name, sign out; a user with `mustChangePassword` can't reach a project until changed.
- [x] `npm run build` green.

## Out of scope

- Admin area (`M26.4.2`), members tab (`M26.4.3`).

## Notes / hazards

- The access token lives in memory only (memory "auth token is memory-only"); after a profile change reload
  `/auth/me` into `AuthStore` instead of decoding the token.
- A self password change bumps the epoch server-side: make sure the UI ends in a signed-in state (silent refresh
  with the new cookie, or re-login) and not in a `401` loop — mirror what `M26.1.3` settles.

## Implementation notes

- `features/account/`: `sf-user-menu` (panel `position: fixed`, so the rail's `overflow: hidden` can't clip it;
  `compact` in the collapsed rail), `AccountComponent` (`/account`), `SetPasswordComponent` (`/account/set-password`),
  `sf-own-password-form` (shared by both), `sf-password-rules` + `password-rules.util.ts` (mirrors `PasswordPolicy`:
  code points, UTF-8 bytes, letter / digit-or-symbol), `PasswordPolicyStore` (fetched once).
- `core/auth/`: `SessionService` (sign out, sign out everywhere, own password change), `passwordChangeGuard` on `''`,
  `account`, `admin`, `p/:projectKey`; `setPasswordGuard`; `passwordRequiredInterceptor` (`428` → set-password with
  `returnUrl`; no error toast). `AuthStore` gains `email`, `mustChangePassword`, `memberships`, `isInstanceAdmin`.
- **Own password change:** the server revokes every session on it, so `SessionService.changeOwnPassword` signs in again
  with the new password (the user stays signed in here, nowhere else).
- **Found on the way (fixed):** the JWT interceptor attached the access token to `/auth/login` and `/auth/refresh`. After
  any epoch bump (membership change, M26.1) that token is revoked, and Spring's bearer filter refused the refresh with
  `401` — the browser signed the user out instead of refreshing (reproduced against the dev server). The interceptor no
  longer sends it there, and the server ignores a bearer on login/refresh/password-policy
  (`SecurityConfig.publicAuthEndpointsIgnoreBearer`, test in `AccountSessionRulesIntegrationTest`).
- `409` duplicate username/email and a wrong current password now carry `field` (`ProblemFactory.conflict(detail,
  field)`), so the forms put them on the right input.
- `/account/password` redirects to `/account#password`; the old `PasswordChangeComponent` is gone.
