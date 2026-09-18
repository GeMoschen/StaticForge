---
id: M24.1.2
status: done
depends: [M24.1.1]
epic: m24-multi-language
feature: project-locales
area: frontend
---

# M24.1.2 — Project Settings → Languages tab

## Context

`ui/src/app/features/settings/project-settings-shell.component.html` hosts tabs (General,
Media, Channels, Generation, Targets, Revisions, …) routed as `settings` children in
`ui/src/app/app.routes.ts`. `ProjectSettingsTargetsComponent` is the most recent precedent
for a list-editing tab with time-travel read-only handling.

## Goals

- New `ProjectSettingsLocalesComponent` at route `settings/locales`, tab label
  **Languages**, visible to `PROJECT_ADMIN` (read-only view for other roles).
- Edit an ordered list of locales (code + label, add/remove/reorder via keyboard-accessible
  controls), pick the default locale, edit each locale's fallback chain (ordered multi-pick
  from the other locales; the implicit trailing default locale shown but not editable),
  toggle "Default locale without URL prefix".
- Inline validation mirrors the server rules; server `Problem` field errors map onto the
  form.
- Before saving a change where the response/diff implies `urlsWillChange`, show a
  confirmation explaining that generated URLs change (with an example built from the
  project's real page, e.g. `about.html` → `de/about.html`) — see `tasks/lessons.md` rule
  on showing concrete rendered examples for output-format choices.
- When a locale being removed still has values, show the warning count returned by the
  server.
- `TimeTravelStore.isTimeTravel` disables all controls (M15.5 pattern).
- `LocalesStore` (signals) in `core/project` exposing `locales`, `defaultLocale`,
  `isLocalized` for the rest of the UI (consumed by M24.4.*).

## Acceptance criteria

- [x] Admin can add `de` + `en`, set `de` default, give `de-CH` the chain `[de]`, save,
      reload, and see the same config.
- [x] Invalid tag, duplicate code and fallback cycle show inline errors and block save.
- [x] URL-change confirmation appears when enabling locales for the first time and when
      toggling "default locale without prefix", and not for a label-only edit.
- [x] Controls disabled in time travel; tab reachable by keyboard; labels/ARIA per §24.7.
- [x] Component spec written; `npm run build` green (spec execution subject to the known
      `templateUrl` runner issue — report status honestly).

## Out of scope

- Locale switching in editors (M24.4.1).
- Translating the CMS UI itself (Angular i18n, spec §23.1) — unrelated to content locales.

## Notes / hazards

- Locale labels are free text for editors; don't derive them from the browser's
  `Intl.DisplayNames` only — offer it as a prefill.

## Implementation notes (2026-09-17)

- `ProjectSettingsLocalesComponent` at `settings/locales`, tab **Languages**. Rows (code, label,
  fallbacks) with keyboard-reachable move/remove/suggest buttons, default-language picker and the
  "default language without URL prefix" toggle.
- The pure validation and the "do the URLs change?" rule live in
  `project-settings-locales.util.ts` — no Angular imports — so `project-settings-locales.util.spec.ts`
  runs for real (14 specs green) instead of hitting the known `templateUrl` JIT runner issue.
- The URL-change confirmation shows a **real page of this project** (first page uid from
  `listPages`) before and after, per the `tasks/lessons.md` rule about concrete rendered examples.
- Disabling languages is refused by the server first (`confirmationRequired`); the tab then shows a
  second dialog naming how many translations would be discarded before re-sending with
  `confirmDiscard=true`.
- `LocalesStore` (`core/project/locales.store.ts`) exposes `locales`, `defaultLocale`,
  `isLocalized` and `chainFor` to the rest of the UI; the project shell loads it per project.
