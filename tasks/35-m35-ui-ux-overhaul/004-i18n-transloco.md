---
id: M35.4
status: done
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

- [x] Transloco works in the app and in vitest (a testing module helper for specs).
- [x] `en.json` exists with `common.*` and `enum.*`. The lint check runs in `npm run lint` (or a dedicated script).
- [x] `npx vitest run` and `npx ng build` green. Bundle budget: raise the limit in `angular.json` if needed; don't
      restructure.

## Notes / hazards

- `npm install` may be offline or rate-limited on this machine (axe-core couldn't be installed earlier). If it is
  blocked, set the task to `blocked` and ask the user.

## Review (2026-09-30)

- `@jsverse/transloco` 7.6.1 + `@jsverse/transloco-messageformat` 7.0.1 (exact pins, Angular 18.2). Runtime loader from
  `assets/i18n/en.json` (angular.json assets glob), `availableLangs ['en']`, `<html lang>` follows the language.
  Missing keys warn in dev, throw in tests. `core/i18n/`, `shared/pipes` (`sfDateTime`, `sfNumber`, `sfEnumLabel`,
  relative time on `common.time.*`). Keys: `<feature>.<screen>.<element>`, `common.*`, `enum.<enumName>.<VALUE>`.
- Specs: `src/test-setup.ts` gives every TestBed `provideTranslocoTesting()` (real en.json, throwing handler); specs that
  reset the TestBed add it themselves.
- Lint: `npm run lint` -> `scripts/check-i18n-literals.mjs` with a shrinking baseline
  (`scripts/i18n-literals.baseline.json`, 136 unmigrated screen files); `shared/**`, `core/ui/**`, `app.component.*`
  must stay clean. Update with `npm run lint:i18n -- --update-baseline` after migrating a screen. Docs: `ui/README.md`.
- Migrated: shared components and helpers, command palette, toast host. Screens are left to their own tasks.
- Verified: `npx vitest run` 147 files / 978 tests, `npx ng build` green (initial 1.84 MB, under the warning limit, no
  budget change), lint green.
- Open: `SF_HOUR_CYCLE` (12/24 h) is not fed by a preference yet (M35.5/M35.10); the UID rename warning is split into
  two keys around `<code>`; CodeMirror vocabulary stays English; not checked in a live browser.
