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

## Notes (M35.21 A)

Phase A (shell, tree, URL, folder view, item actions, New template dialog, Used by drawer) is built; the editor content is unchanged inside the new shell.
Phase B (IDE header, Settings section, splitter / tabs below 1280 px, diagnostics, the `{locale}` client check, the palette per user) and phase C (the dataset editor) are open.

- **Built:** `templates.component` (splitter + `sf-tree` + folder table / Favorites / router outlet), `template-editor.component` (the child route `:uuid`; hosts the old meta header, CDL / channel
  panels, save outcomes and the dataset editor), `templates-folder-view.component`, `templates-item-actions.service` (delete question naming what uses the items, delete / move / rename / create /
  duplicate and their Undo), `templates-tree.util` (index, nodes, search, trail), `templates-move-dialog.component`, `new-template-dialog.component`, `templates-store-refresh.service`.
  Removed: `template-folder-node`, `template-nav-node`, `templates-tree-pane` (nothing referenced them any more).
- **URL:** `/templates/:uuid` (guard `unsavedChangesGuard` on the child route, so another template, a folder or another area asks first; `TemplatesStore.whenMayLeave` / `select` / `selectFolder` are gone),
  `?folder=<uuid>`, `?favorites=1`. `?asset=<uuid>` redirects to the route, `?kind=DATASET` opens the Datasets folder. `assetRoute` (search, recents, palette, favorites) now returns `/templates/<uuid>`;
  `openedAsset` reads the uuid from that path.
- **Shared components touched:** `sf-tree` got `hostMenu` (the menu is the host's entries + Delete, no cut / copy / paste) and `renameRequest` (F2 asks the host instead of editing in place) so the tree menu is exactly
  decision 157 and *Rename…* is the Content rename dialog (`sf-rename-asset-dialog`: name, UID with Change UID, Undo). `sf-folder-move-dialog` got `rootSelectable`, `unavailable` and `unavailableHint`
  (the top level "Templates" and the folders of other kinds are shown but not choosable). `sf-record-side-panel` got `tabs="usages"` and `title` (the Used by drawer) and the *record set* / *section template* type labels and links.
- **Deviations to approve:**
  1. **No "Based on" in the New template dialog.** `CreateTemplateRequest` / `CreateDatasetRequest` have no parent field: `parentTemplateRef` is derived from the `$CMS_EXTENDS(…)$` in a channel source on save,
     so a template cannot be created "based on" another without writing a channel source for a guessed channel. The field is left out (not shown disabled); the sample and decision 155 show it. Needs a decision (backend field or a generated extends line).
  2. **UID in the dialog:** the create calls take no UID (the server derives it from the name), so an edited UID is applied after creating with the UID change call; if that fails the template is kept and a toast says the UID was not applied.
  3. **Duplicate** has no endpoint for templates / datasets (only pages): it reads the original and creates "<name> copy" next to it (all CDL sections, channel sources, category, paths, flags; a dataset with its record templates); Undo deletes the copy.
  4. **Where a new item goes:** the folder it was started from when that folder holds that kind, else the fixed folder of the kind ("Created in Section Templates."); nothing is created in the top level, and *New ▸ Folder* is disabled there.
  5. **Used by in the header:** the editor has no ⋮ before phase B, so the old meta header got a *Used by* button (it opens the same drawer). The header's Delete now uses the new confirmation (names what uses the template, Undo, back to the folder); the old inline confirm dialog is gone.
  6. The table has no avatar in *Modified* (the API sends the time only, as for record sets), and the Kind filter chips have no icons (`SfDataTableFilterOption` has no icon).
  7. The fixed folders (Page templates, Section templates, Datasets) are listed in that order (the tree uses `sort="none"`: folders first, then templates, each by name) and cannot be renamed, moved or deleted; page templates, section templates and datasets cannot be moved into each other's folders (drag and drop, *Move to…*, the table's *Move…*).
- **Specs:** `templates.component.spec` (editor behaviour under the area, URL as the selection, the guard on a switch: Cancel / Discard / Save), `templates-undo.spec`, new `templates-area.component.spec` (URL selection, tree menu, New dialog flow, rename, Used by, delete),
  `templates-folder-view.component.spec`, `new-template-dialog.component.spec`, `templates-item-actions.service.spec`, `templates-tree.util.spec`, plus additions to `sf-tree`, `record-side-panel`, `asset-route.util` and `opened-asset` specs.
