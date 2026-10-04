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

## Notes (M35.21 C)

Phase C (the dataset editor redone on the sample's tabs, gate decision 167) is built. The old `dataset-schema-editor` and `dataset-record-templates` components are removed (nothing referenced them any more);
`DatasetTemplatesStore` and `record-template.util` stay in `features/content` and are reused unchanged (one small addition: `selectTab(channel, reopened)`).

- **Built (`features/templates/`):** `dataset-editor.component` (selector `sf-dataset-editor`, inputs `projectKey` / `uuid`, outputs `changed` / `deleted` as before), `dataset-overview.component`
  (the Overview tab), `dataset-fields.util` (fields table rows from the compiled definition + rule counts). `sf-code-panel` got public `goTo(line, column)`, `insert(snippet, caret)` and `focus()`.
  `template-editor.component` only had its import and tag swapped (`sf-dataset-editor`); `templates-undo.spec` imports `DeletedDataset` from the new file.
- **Page:** `sf-page-header` (name, *Dataset* badge, `sf-save-status`, *Save dataset* enabled only when dirty, ⋮ with *Rename…* / *Duplicate* / *Used by* / *Delete*), a UID line (copyable) and `sf-tabs`:
  *Overview* (fields table, description + title field + loop snippet, *Used by* list + record count linking to Content), *Schema* and *Rules* (CDL `sf-code-panel`s: editable, Format, Validate, diagnostics list with jump,
  live validation 400 ms, server diagnostics by `field` on the failing tab), one tab per channel (OCTL `sf-code-panel`, field / record click-to-insert chips, live check, disabled / empty notes, caret on the first error after a rejected save).
  Tab strip shows error counts, unsaved dots and *disabled*; the panels are kept alive while hidden (undo history, caret).
- **Behaviour kept:** one save request (schema + description + title editor + every record template, ETag), brokenRecordSets list, 409 reload, delete only without records (+ Undo through `ContentService.restoreDataset` in `template-editor`), time travel / non-developer read-only.
- **Deviations:**
  1. **Display name** is no longer a form field; *Rename…* opens the Content rename dialog (name, UID with Change UID, Undo) and applies at once, not with the schema Save; the editor keeps unsaved edits and only patches name / revision.
     The inline `sf-uid-rename` is gone (Change UID lives in that dialog).
  2. **Unsaved guard:** the old dataset editor registered nothing with `ActiveEditorService` (the area's coordinator registered the template state, which is never dirty for a dataset, so a dataset had no guard). The new editor registers its own state
     (dirty, saving, last saved, refused-save error, Save, Discard = reload), so Ctrl+S, the leave guard and tab close now work for datasets; its own Ctrl+S keydown handler is dropped (the global shortcut covers it).
  3. **Delete** uses `TemplatesItemActions.confirmDelete` (names what uses it, Undo wording) instead of the old inline confirm; it stays disabled in the menu (with a reason) while the dataset has records.
  4. **Fields table** shows the *saved* schema (the server-compiled definition), not the CDL as typed; the rules count is the number of `rule … on <field>`, `state <field>` and `fill <field>` entries in the saved Rules source (a text scan; built-in modifiers are not counted).
  5. **Add / remove channel:** as in the old editor there is no add / remove control: every enabled channel of the project has a tab (plus disabled ones holding a template); an emptied template is dropped on save.
  6. The page header has no breadcrumb (the frame's breadcrumb already ends with the dataset); the sample's header breadcrumb is not repeated.
  7. Re-opening a channel tab after Schema / Rules re-checks its template (the old UI could not leave the template for the schema without switching channel).
- **Specs:** `dataset-editor.component.spec` (the old spec ported: tabs, dirty tracking, one-request save, rejected save + caret, schema errors on the failing tab, broken record sets, helpers, live checks, editor / time-travel read-only, delete + decline; new: overview table, Used by, description / title field, ActiveEditorService, ⋮ menu: Used by / Duplicate / disabled states), `dataset-fields.util.spec`.
- **Open for the other agent:** `template-ide` replaces `template-editor` for page / section templates; whichever hosts the router outlet child must keep the `store.datasetSelected()` branch rendering `<sf-dataset-editor [projectKey] [uuid] (changed) (deleted)>` with `onDatasetChanged` / `onDatasetDeleted` (Undo + navigation) as `template-editor` has them.

- **Based on (decided 2026-10-04):** copies the chosen item's contents (CDL, channel templates, record templates, settings) into the new template or dataset; no parent field and no generated extends line.
  Implemented in `TemplatesItemActions.create(basedOn)` sharing the copy code with *Duplicate*; the dialog lists the existing items of the chosen kind.

## Notes (M35.21 B)

Phase B (the IDE chrome for page and section templates) is built; the dataset editor (phase C) is the other agent's. Gate round 13 decisions 158–163 and 166 are implemented as signed off.

- **Built:** `template-ide.component` (new: header, banners, Settings, the `sf-splitter` at >= 1280 px / `sf-tabs` CDL | Channels below with the errors of each side, the impact panel, the states: nothing selected, skeleton, load error with Retry, and the `ConfirmService` question before a save that discards translations),
  `templates-meta-header` (rewritten: `sf-page-header` with name, favorite star, kind badge, inheritance chain as breadcrumb, save status or the read-only text, primary Save with `aria-keyshortcuts`, ⋮ with Duplicate / Rename… / Move to… / Used by / Delete…, UID with `sf-copyable`),
  `templates-settings` (new, collapsible, summary of the output paths when collapsed), `templates-save-outcomes` (rewritten as `sf-banner`s), `templates-cdl-panel` and `templates-channel-panel` (rewritten on `sf-code-panel`), `output-path.util` (the `{locale}` check as a pure util).
  `template-editor.component` only picks IDE or dataset editor now. Removed: `templates-panel.scss`, `templates-editors.scss`, `templates-pagination.scss`; `templates-inheritance.scss` is cut down to the inherited groups.
- **`sf-code-panel` carries everything** (completions via `names`, formats via `format` / `svg`, read-only, diagnostics with jump to line), so `sf-cdl-sections-editor` / `sf-octl-editor` are no longer used by templates (they stay for the dataset editor and global sets). The sections / channels keep one live editor per tab (hidden, not destroyed), so undo history survives.
- **Output paths are now editable** (they were only passed through on save): `store.outputPaths` / `savedOutputPaths`, part of `dirty`, sent by the one Save (blank entries are left out, like pagination paths). Page templates only. The `{locale}` check (decision 163): client message while typing when `LocalesStore` has more than one language and the path lacks `{locale}`; the server's SF-GEN-0112 is dropped when the client says the same or when the path was edited (it judged the saved path); at most the distinct messages per channel, under that channel's field.
- **Header ⋮ → area:** Duplicate, Rename… and Move to… are the area's dialogs, so the header asks through `store.itemRequest` (like `usedByUuid`) and `TemplatesComponent` does it (small effect added there). Delete is `TemplatesSaveCoordinator.requestDelete` (phase A).
- **Palette per user (decision 166):** `CodePaletteService` (core/ui) + `PreferencesService.codePalette` (`codePalette` key of the preferences document; the server stores it as is), applied as `data-code-palette="refined"` (Current sets no attribute), created at start-up with theme and density, switchable in My account › Preferences. No palette switch in the template header.
- **Deviations / decisions to confirm:**
  1. **No per-channel switch in Settings.** The sample has a switch per channel; the app has no enabled flag per channel (a channel is on when the template has a source for it). Each channel is a chip with ✕ (remove; "Removed when you save: x — Undo") and *Add channel* is the menu; the old "Remove channel" button in the panel is gone.
  2. **Rename UID** is only in the *Rename…* dialog (name + Change UID); the inline `sf-uid-rename` of the old header is gone, as decided for the other editors.
  3. The refused-save banner is not shown while the broken-descendants banner is (that one says why); a template pages still use is explained under *Abstract* (inline, naming the pages with links) and by the generic banner.
  4. The old hand-rolled discard panel is a `ConfirmService` dialog (title, the server's message, *Discard and save* / *Keep the translations*).
  5. Existing toasts of `TemplatesSaveCoordinator` / `TemplatesEditing` ("Template saved", validation toasts) are still literal English; they are not part of this phase's templates and were left (no baseline growth).
  6. Settings opens by itself for a pagination path error or a refused *Abstract*, so nothing needing attention hides in the collapsed section. It starts collapsed (as in the sample).
  7. Not checked in a real browser at 1024 / 1440 px in this phase (jsdom specs only).
- **Specs:** `template-ide.component.spec` (header, Save, ⋮, read-only / archived, Settings summary, output path edit and save, the `{locale}` check, channel ✕ / Undo / Add, pagination rule, section template, splitter vs tabs at 1280 with a live media change, error counts on the tabs, refused / broken / info banners, discard question both ways, skeleton, Retry, nothing selected), `output-path.util.spec`, `code-palette.service.spec`, `account-pages.spec` (palette next to Theme and Density), the header requests in `templates-area.component.spec`; `templates.component.spec` adapted to the new chrome.
