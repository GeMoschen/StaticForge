---
id: M35.21
status: todo
depends: [M35.11, M35.12, M35.13, M35.14, M35.15]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.21 — Templates IDE

## Context

`features/templates/*` (after M35.2), `sf-cdl-sections-editor`, `sf-octl-editor`, `dataset-schema-editor`.
Screenshots 50–53 and E5. The CDL/OCTL split editor (M34) is strong; keep its behaviour. Developer-only screen (hidden
in editor view).

## Goals

- **Tree** (`sf-tree`):
  - Page templates, section templates, datasets, folders.
  - Filter.
  - A full menu: New (explicit kind: page template, section template, dataset, folder), Duplicate, Rename, Move, Delete
    (confirm and undo), Used by.
  - One selection style (fixes the double highlight).
- Selection lives in the URL (`/templates/:uuid`). Switching templates goes through the unsaved guard (M35.13).
- **Folder view:** `sf-data-table` of templates: name, kind, channels, used by (count), modified.
- **IDE:**
  - `sf-page-header`: name, kind, inheritance chain as breadcrumb, save status, primary *Save* (enabled only when
    dirty, `Ctrl+S`), ⋮.
  - Metadata and pagination paths in a collapsible *Settings* section.
  - CDL panel and channel panel in an `sf-splitter`, stacking below 1280 px as tabs (CDL | Channels) so nothing is
    clipped at 1024.
  - Diagnostics list per tab, with jump-to.
- **Output path check:** warn inline when a multi-language project's output path lacks `{locale}` (M35.1 item 10
  provides the rule).
- **New template dialog:** the kind is chosen explicitly, never inferred from the selection.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated (URL selection, guard on switch). `npx vitest run` and `npx ng build` green.

## Notes (M35.9)

- Decide first (open from the gate): the code highlighting palette - current M35.5 or Refined (decision 18). The
  current one stays the default; Refined is available via `data-code-palette="refined"`.
- The sample (decisions 14-17) is the reference:
  - Datasets sit under Templates (developer mode): a header, an overview tab (fields table; record sets using it) and
    the CDL / record-template tabs as code editors.
  - Both the page template "Article" and the section template "Product teaser" (the catalog's card type) are
    selectable. CDL (content, bodies, rules tabs) and the channel templates (html, rss) in OCTL sit in an
    `sf-splitter`, with a settings section (output path, pagination) and one deliberate diagnostic.
  - Editor chrome is IDE-style: a header strip per editor (file-like name, language, Format, Find), gutter with line
    numbers and fold markers, active line, bracket matching, squiggles, a diagnostics list with jump to line, and a
    status line (Ln, Col, errors, warnings). The editor background follows the theme.
  - `sf-code-panel` with CDL/JSON formatting is already in the design system.

## Notes (M35.15 favorites)

- The templates tree: add the pinned *Favorites* node (`pinned: true`, only while there are favorites; children from
  `FavoritesService`, flat with an icon per kind, favorite folders as lazily loaded folder nodes, a click on the node opens
  the Favorites list in the main pane) and *Add to / Remove from favorites* to the row context menu (and a hover/focus ☆
  in table name cells). The design is in the sample (`/styleguide/sample`, gate round 5, decisions 57–58). Favorites are
  not store-bound: the node lists them from every store.
- Put the open item in the URL (`?asset=` / `?folder=`, or the route's UUID) so it is recorded as a recent.


## Notes (M35.21 — sample first)

- Status 2026-10-04: **sample extended, app not changed.** The folder table, Used by, New template dialog, delete / rename / move / duplicate, the definition fields, channel add / remove,
  descendants, save outcomes and the template view's states were missing from the sample; they are now in it as **gate round 13** (decisions 153–167, screenshots in
  `round13-shots/`). **Signed off 2026-10-04** with decisions: palette per user in account preferences (166), `{locale}` client check + server warning (163), backend `channels` / `usedByCount` / `changedAt` (164), dataset editor redone (167).
- Plan once signed off: A. shell on `sf-splitter` + `sf-tree` with `/templates/:uuid`, menus and a templates item-actions service (after M35.20's `content-item-actions.service`);
  B. folder view; C. IDE header + Settings + splitter / tabs below 1280 px; D. dialogs (New template with explicit kind, Used by); E. i18n, specs, Chrome check, review.
