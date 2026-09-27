---
id: M30.6.1
status: done
depends: [M30.1.2, M30.2.1, M30.2.2, M30.2.3]
epic: m30-quality-checks-and-redirects
feature: ui
area: frontend
---

# M30.6.1 — Project settings: Quality tab

## Context

`features/settings/project-settings-shell.component.html` (tabs), `app.routes.ts` (`settings` children, `:121`ff),
`GET/PUT /projects/{key}/quality-rules` (`M30.1.2`), `project-settings-locales.component` (validated settings form with
per-entry errors — the model), `AuthStore.roleFor`, `ProjectAccessStore.readOnly`. Epic decisions 4, 5.

## Goals

- Tab **Quality** at `settings/quality`, visible to every member; editable for `DEVELOPER+` (read-only otherwise, and in
  time travel / archived projects).
- Three groups (Links, SEO, Accessibility); per rule: name, code, description (incl. "fix in content/template" hint),
  a segmented control *Off · Warning · Error* (default marked), parameter inputs with bounds (title and description
  lengths, canonical required), "reset to default" per rule, "HTML channels only" note at the top.
- One Save for the whole form, enabled only when dirty **and** valid (lessons 2026-09-18); server `errors` shown on their
  rules; after save, a hint: "The next incremental build runs as a full build because the rules changed."
- `0103` shows that *Error* is treated as *Warning* (decision 6), with the option disabled.

## Acceptance criteria

- [x] Vitest specs with fixtures shaped like `schema.d.ts`: grouping, dirty/valid gating, read-only per role and in
      time travel, reset to default, server errors mapped to rules, `0103` error option disabled.
- [x] Manual check in the running app as developer and as editor.
- [x] `npm run build` and `npx vitest run` green.

## Out of scope

- Per-page rule overrides.

## Notes / hazards

- The segmented control must reflect the *effective* severity from the server, not a local default (lessons
  2026-09-18 "A `<select>` that shows an option the model never chose").

- **Done (2026-09-27):** tab **Quality** at `settings/quality` (between Generation and Redirects),
  `project-settings-quality.component.*`, `quality-rules.service.ts`, `quality-rules.util.ts`; rights
  `ProjectPermissionsStore.canEditQualityRules` (`DEVELOPER+`, writable). Per rule: name, code, `fixHint` as
  "Fix in content / Fix in the template / Content or template", description, *Off · Warning · Error* radios (a
  segmented control; "(default)" marks the default), parameters with bounds, "Reset to default". The form checks what
  the server checks before sending (whole numbers within `min`/`max`, and minimum ≤ maximum for the length rules);
  the `PUT` body carries only what differs from a rule's defaults, so a reset rule leaves the configuration.
  Specs: `project-settings-quality.component.spec` (12: util, grouping, marks, caps, dirty/valid gating, save + full
  build hint, reset, server errors per rule, read-only for editors and in time travel; fixtures from a captured
  `GET /quality-rules`). Manual check (backend 8092 / UI 4312, Playwright): developer edits, invalid min > max blocks
  Save, save + hint, reload shows the stored values, reset; editor sees the stored values read-only.
- Deviation: not only `0103` is capped: `GET /quality-rules` already exposes `maxSeverity`, which is `WARNING` for
  `SF-CHK-0001` (checker problem), `0103` and `0210` (both run after the hold-back). The tab treats every capped rule
  alike (Error disabled with the reason; a stored `ERROR`, possible through the API, shows as the Warning it is applied
  as, with a note). `QualityRuleCatalogTest.onlyTheCheckerAndTheRulesAfterTheHoldBackAreCappedAtWarning` pins the set.
- Deviation: the API sends `min`/`max: null` for a boolean parameter (the generated type says `number`); the util
  treats `null` as "no bound".
