---
id: M35.4
status: todo
depends: []
epic: m35-ui-ux-overhaul
feature: i18n
area: frontend
---

# M35.4 — Transloco setup and string extraction rules

## Context

User decision 16. Today every UI string is an English literal. There is no i18n mechanism, and `<html lang="en">` is
fixed.

## Goals

- Add `@jsverse/transloco`, pinned to a version that fits the installed Angular. Configure it:
  - Runtime JSON loader from `assets/i18n/en.json`.
  - `availableLangs: ['en']` and fallback `en`.
  - `missingHandler` logs missing keys in dev and fails in tests.
- Key convention: `<feature>.<screen>.<element>` (for example `pages.editor.save`), plus shared `common.*`
  (Save, Cancel, Delete…) and `enum.*` for the human labels of enums (roles, statuses, audit actions, job states).
- Plurals and interpolation via Transloco's messageformat plugin, which replaces "3 page(s)".
- Date, time and number formatting through one pipe set that follows the active language: relative times, and
  absolute times in the user's locale (24 h / 12 h).
- A lint check (script or ESLint rule) that flags new user-visible string literals in templates, used by the screen
  definition of done.
- Migrate the shared components and the app shell as the first consumers. Screens migrate in their own tasks.

## Acceptance criteria

- [ ] Transloco works in the app and in vitest (a testing module helper for specs).
- [ ] `en.json` exists with `common.*` and `enum.*`. The lint check runs in `npm run lint` (or a dedicated script).
- [ ] `npx vitest run` and `npx ng build` green. Bundle budget: raise the limit in `angular.json` if needed; don't
      restructure.

## Notes / hazards

- `npm install` may be offline or rate-limited on this machine (axe-core couldn't be installed earlier). If it is
  blocked, set the task to `blocked` and ask the user.
