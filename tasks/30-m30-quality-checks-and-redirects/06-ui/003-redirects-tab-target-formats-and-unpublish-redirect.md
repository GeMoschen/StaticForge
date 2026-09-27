---
id: M30.6.3
status: done
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

- [x] Vitest specs with API-shaped fixtures: table states, filters in the URL, add/edit/delete incl. `409`, read-only per
      role, target form round trip of `redirectFormats` (default checked on a new target), unpublish dialog option
      (preselection, call order, failure warning).
- [x] Manual check in the running app: move a page, build, see the AUTO entry and the stub in the output folder.
- [x] `npm run build` and `npx vitest run` green.

## Out of scope

- Bulk import of redirects (CSV).

## Notes / hazards

- `from_path` input: the user types a URL path as they know it (`/old/page.html` or `/old/page/`); normalize to the
  output-path form the API expects and show the normalized value before saving.

- **Progress (2026-09-27, first part):** the Redirects tab and "Redirect old URL to…" are done; the target form's
  `redirectFormats` checkboxes are **pending** (the target DTO field arrives with `M30.5.1`), so the task stays
  `in-progress`. Specs so far: `redirect.util.spec` (normalization mirrors `RedirectPaths`, labels incl. `LOOP`),
  `project-settings-redirects.component.spec` (states + tooltips, filters in the URL and as chips, read-only per role
  and in time travel, delete with `If-Match` and the `409` reload prompt), `redirect-dialog.component.spec` (add/edit,
  normalized paths, `If-Match`, `409` → reload), `redirect-option.util.spec` (preselection),
  `release-dialog.redirect.spec` (preselection, call order, failure warning, rights, release of a deletion),
  `page-delete-dialog.component.spec`. Manual check (own backend 8083 / UI 4302): manual add/edit/filter, unpublish
  and tree delete with a redirect → `SHADOWED` rows, Changes-view release of a deletion offers the option. The AUTO
  entry + stub part of the manual check needs `M30.4.2`/`M30.5.x` and is still open.
- Deviation: the list API had no state filter, so `GET /redirects` gained `state` (`ACTIVE|SHADOWED|DANGLING|LOOP`;
  computed per row, paged after filtering; nothing matches while the default target has no build) —
  `RedirectService.Filter.state`, tested in `RedirectApiIntegrationTest.states`, `schema.d.ts` updated by hand (one
  line; a regenerated file only reorders unrelated `Page*` properties).
- Deviation: "M27 delete dialogs" — the page tree's delete was a `window.confirm`; it is now `sf-page-delete-dialog`.
  The page editor has no delete action, and the Changes view deletes nothing itself: there the option appears when a
  release publishes a page's **deletion** (`DELETION_PENDING`), the moment the page goes offline.
- Deviation: a project UID is unique per type, so only one page can carry the index UID. The preselected "folder
  index page" is the page in the folder with a channel's `indexUid`, or else the page beside the folder named like it
  (`products` next to `products/`), nearest folder first, online pages only, never a page going offline itself.
- Deviation: the redirect after the dialog is reported as a toast with an "Open Redirects" action: info ("…once a
  build no longer contains the page. Until then the redirect shows as Shadowed.") or a warning on failure.
- **Done (2026-09-27, second part):** the target form has a "Redirect output" group — *HTML redirect pages*
  (checked on a new target), *Apache .htaccess* ("Apache only: …"), *redirects.json*. Editing shows the view's
  `redirectFormats` (the server resolves a missing key to the default); saving always writes an explicit
  `config.redirectFormats` in the server's order (`[]` when none is checked, which a missing key can't say); a `400`
  on the field shows the server's message. Specs: `project-settings-targets.component.spec` (default on a new target,
  empty list, edit round trip, rejected formats). Manual check (backend 8092 / UI 4312, Playwright + output folder):
  new target defaults to HTML stubs, `.htaccess` added to the default target and shown again on reopen; page `about`
  moved from `docs/` to `guides/`, released, incremental build → Redirects tab shows `docs/about.html` *Automatic*,
  *Active*, → `guides/about.html`, "from run #2"; `builds/2/docs/about.html` is the stub (refresh to
  `../guides/about.html`, canonical `https://example.com/guides/about.html`, noindex) and `builds/2/.htaccess` holds
  `RedirectMatch 301 "^/docs/about\.html$" "/guides/about.html"`.
