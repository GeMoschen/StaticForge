---
id: M30.6.1
status: todo
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

- [ ] Vitest specs with fixtures shaped like `schema.d.ts`: grouping, dirty/valid gating, read-only per role and in
      time travel, reset to default, server errors mapped to rules, `0103` error option disabled.
- [ ] Manual check in the running app as developer and as editor.
- [ ] `npm run build` and `npx vitest run` green.

## Out of scope

- Per-page rule overrides.

## Notes / hazards

- The segmented control must reflect the *effective* severity from the server, not a local default (lessons
  2026-09-18 "A `<select>` that shows an option the model never chose").
