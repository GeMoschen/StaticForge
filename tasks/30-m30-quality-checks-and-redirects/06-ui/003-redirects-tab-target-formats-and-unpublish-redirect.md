---
id: M30.6.3
status: todo
depends: [M30.4.1, M30.5.1]
epic: m30-quality-checks-and-redirects
feature: ui
area: frontend
---

# M30.6.3 — Redirects tab, redirect formats per target, "Redirect old URL to…"

## Context

`features/settings/project-settings-url-registry.component.*` + `url-registry.service.ts` (paged list with filters —
the model), `project-settings-targets.component.*` (target form), `/projects/{key}/redirects` and `/redirects/for-asset`
(`M30.4.1`), target DTO `redirectFormats` (`M30.5.1`), M27 unpublish and delete dialogs (page editor, page tree,
Changes view), the shared page picker used by link/reference editors, M28 effective permissions. Epic decisions 14–18.

## Goals

- Tab **Redirects** at `settings/redirects`: paged table (from path, channel, locale, target — page display name +
  current path or URL, kind *Automatic/Manual*, state *Active/Shadowed/Dangling* with an explanation tooltip, created
  when/by or "from run #n" linking to the run); filters channel, locale, kind, state, text. `DEVELOPER+`: add manual
  (from path, channel, locale, target: page picker or URL), edit (with `If-Match`; `409` → reload prompt), delete with
  confirmation; read-only otherwise.
- Target form: "Redirect output" checkboxes *HTML redirect pages* (default), *Apache .htaccess* ("Apache only"),
  *redirects.json*; saved with the target.
- M27 **unpublish** and **delete** dialogs of a page that currently has published output: an option "Redirect old URL
  to…" with a page picker preselected with the nearest published ancestor folder's index page (or none); on confirm,
  after the unpublish/delete succeeded, call `POST /redirects/for-asset`. Shown to users who may unpublish (M28
  `RELEASE`) or are `DEVELOPER+`; a failure of the redirect call after a successful unpublish shows a warning with a link
  to the Redirects tab (the unpublish is not rolled back).

## Acceptance criteria

- [ ] Vitest specs with API-shaped fixtures: table states, filters in the URL, add/edit/delete incl. `409`, read-only per
      role, target form round trip of `redirectFormats` (default checked on a new target), unpublish dialog option
      (preselection, call order, failure warning).
- [ ] Manual check in the running app: move a page, build, see the AUTO entry and the stub in the output folder.
- [ ] `npm run build` and `npx vitest run` green.

## Out of scope

- Bulk import of redirects (CSV).

## Notes / hazards

- `from_path` input: the user types a URL path as they know it (`/old/page.html` or `/old/page/`); normalize to the
  output-path form the API expects and show the normalized value before saving.
