# M35 — UI/UX overhaul (new visual identity, app frame, shared patterns, every screen)

**Spec:** Rewrites §23 (frontend architecture: design system, shell, shared components, state) and §24 (UX: layout,
screens, keyboard, accessibility, responsive); touches §20 (one new user-preferences endpoint). Not part of the
original §27 roadmap — inserted the same way `M8`–`M34` were.

## Goal

The UI grew screen by screen over 34 milestones. Its features are rich, but it has no common frame, and the same kind
of thing is built differently on each screen: 4 tree implementations, 5 tab implementations, 3 confirm mechanisms,
5 rename patterns, 187 raw `<button>`s next to `sf-button`, 13 undefined design tokens, and unstyled native inputs in
the core editors. After M35 the UI has a **professional, clean, modern, enterprise-dense** look. It adapts to the
user's role, is keyboard-first, and every screen is built from one design system. It also covers the common features
people expect from a CMS: breadcrumbs, a project switcher, recent items and favorites, bulk actions, undo, unsaved-changes
guards, dark mode, resizable panes, a shortcut sheet and skeleton loading.

## User decisions (2026-09-30)

1. **Look.** A new visual identity: professional, clean, modern, **enterprise dense** (Fluent/Carbon-like: clear
   structure, toolbars, compact rows).
2. **Type and colour.** **Inter** for UI and headings (Fraunces is dropped), JetBrains Mono for code. A single **blue**
   accent (≈ `#2563eb`) on neutral slate greys. Semantic success/warning/danger/info colours. Red is reserved for
   danger and errors, never used for status or emphasis.
3. **Density.** Compact by default (rows 28–32 px). A per-user **Comfortable** option.
4. **Theme.** Light / Dark / **System**, persisted per user. Every token has a dark value, and no hardcoded colour is
   allowed.
5. **Icons.** Keep Material Symbols (Outlined, weight 400, 20 px, used consistently). Every icon-only button has an
   accessible label and a tooltip.
6. **Frame.** A **top bar** plus a **left rail**:
   - The top bar holds the project switcher (with recents and favorites), a breadcrumb, search, build status with a
     *Build now* action, History, the editing language, theme, the shortcut sheet and the user menu.
   - The rail is collapsible and has labelled groups.
   - Admin and Account use the same frame.
7. **Roles.** The UI is driven by **permissions**: nothing the user can't use is shown. Users with developer rights
   also get a **Developer mode** toggle. *Off* gives the editor view: the rail shows only editorial areas, and
   Templates, schemas, Channels, developer settings, UIDs and CDL hints are hidden. It is on by default for developers
   and admins.
8. **Information architecture.** Generation moves out of Settings into its own rail item **Publishing**: runs,
   *Build now*, targets and publish policy. Changes and Schedules stay separate items next to it. Settings gets a side
   menu, and **Settings → General is split** into sub-pages.
9. **History.** The permanent revision spine is **removed**. *History* opens a timeline drawer: the asset's history in
   an editor, the project's history elsewhere. From the drawer, **Open full history** leads to a full-page timeline
   (moved out of Settings; project roll-back lives there). Time travel shows a clear banner with *Back to now*.
10. **Destructive actions.** Every `window.confirm` / `window.prompt` is replaced by one in-app confirm dialog, with a
    typed confirmation for large deletes. Delete, move and rename also offer **Undo** in the toast. Undo works through
    the existing `POST /assets/{uuid}/restore` and move endpoints.
11. **Save model.** The split stays:
    - Content autosaves: pages, records, global values and media metadata.
    - Code and structure use explicit Save: templates, schemas and settings.

    The save UX is the same everywhere: one save-status indicator in the screen header, `Ctrl/Cmd+S` everywhere, and an
    unsaved-changes guard (route change and tab close) everywhere.
12. **Keyboard.** **Full keyboard-first.** The command palette is a primary interaction (navigate, create, build,
    release, switch project, toggle theme, density and dev mode, open recents and favorites). Every action has a
    shortcut. A `?` shortcut sheet and `g`-chords are added. Trees support `Ctrl+X/C/V`, `F2` rename, `Del` and
    arrow-key navigation.
13. **Responsive.** Optimised for ≥ 1280 px and fully usable down to 1024 px (panes collapse or stack). Below ~840 px
    there is an honest **review mode**: browse, preview, Changes and release, but no template or code editing.
14. **Recents and favorites** appear in the switcher, the palette and the dashboard. **Resizable and collapsible
    panes** use keyboard-operable splitters.
15. **Preferences** (theme, density, dev mode, favorites, recents, pane sizes, tree expansion, rail state) are stored
    **on the server, per user**, so they follow the user across browsers.
16. **UI language.** i18n-ready with **Transloco** (runtime JSON). Only English ships. Every string is extracted.
17. **Trees.** One shared tree component. Siblings stay **sorted by name**; there is no manual ordering, and
    Navigation keeps the order it already has.
18. **Folder views.** A selected folder (Pages, Content, Templates) shows a **table** of its children. The table is
    sortable and filterable and supports multi-select with bulk move, delete, release and duplicate. Media keeps its
    grid and gains a list view.
19. **Identifiers.** UIDs, UUIDs and internal paths (`/pages_root/…`) are shown **only in developer mode**, as
    secondary, monospace, copyable text. Enums are always shown as human labels. A UUID is never a primary label.
20. **Language rows.** Changes keeps **one row per language** (restyled). Language chips on fields appear only when
    the template or dataset is actually localized.
21. **Extras in scope.** Dashboard 2.0, preview upgrades and loading skeletons. Help and onboarding are **out of
    scope**, except the shortcut sheet.
22. **Refactor.** **Dedicated behaviour-preserving tasks** decompose the large components before any visual work.
23. **Bugs.** The functional bugs found in the UX run are verified and fixed **first**, in their own task.
24. **Order.** Bugs → refactor (in parallel with the design system) → **design gate** (a living style guide the user
    signs off) → frame → screens → extras → closing.
25. **Verification.**
    - Every screen task reviews screenshots of its screens (light and dark, compact and comfortable, 1440 and 1024,
      plus 390 where review mode applies).
    - Playwright visual-regression baselines are committed for key screens.
    - Journeys are updated in one closing task, not per screen.
    - Accessibility (focus trap, keyboard trees, menus and splitters, headings, labels) is part of the components'
      acceptance criteria. There is no axe gate.
26. **Spec and docs.** Spec §23/§24 and `docs/user-guide.md` are rewritten to the new UI.

## Findings from planning (2026-09-30)

A code audit and a screenshot run found the following. The run used a seeded project with 111 screenshots at 1440,
1024 and 390 px, in light and dark.

**Frame and IA**
- `app.component.html` renders only the router outlet plus the palette, context menu and toasts. There is no top bar,
  breadcrumb or page title (`<title>` is always "StaticForge").
- `rail__switcher` is a non-interactive `<div>`. Inside a project there is no way back to the project list.
- Generation (Settings → Generation), Channels and Languages (Settings → General), and Revisions are buried in
  Settings.
- Settings → General stacks 6 unrelated sections, each with its own Save.
- The revision spine is a column of ~20 unexplained red numbers on every screen. Time travel leaks: the tree shows
  later items, and the toast follows the user out of the project.
- Admin and Account use a different, centered layout with different tabs.

**Design system**
- Tokens missing from `tokens.scss` but used: `--sf-radius`, `--sf-muted`, `--sf-canvas`, `--sf-danger`,
  `--sf-panel`, `--sf-hover`, `--sf-ink-soft`, `--sf-surface-muted`, `--sf-signal-muted`, `--sf-shadow-md/lg`,
  `--sf-amber-700`, `--sf-text-2xs`.
- 12 ad-hoc z-index values. Hex/rgba colours in 25 stylesheets. 154 px literals. 21 inline `styles:`. Dead CSS in
  `app.component.scss`.
- Unused: `features/design/design-demo.*` and `sf-tooltip`. `sf-tree` is an empty wrapper.
- `sf-button` has no size, icon or loading variants. `sf-field` doesn't link its hint (`aria-describedby`) and has no
  error slot. `sf-empty-state` always emits `h2`.
- The core editors (page, record, global set) and Languages use unstyled native inputs. Read-only inputs are
  unreadable in dark mode. The disabled primary button looks enabled (faded salmon). Solid-red buttons (Delete,
  Reset all, Roll back, Enable compaction) outweigh primary actions.

**Patterns**
- Trees: Pages (`folder-node`, `page-nav-node`), Media, Templates, and `sf-store-tree-node` (Content, Navigation,
  Globals) each differ in width, header, create button, context menu, selection style and keyboard handling.
  Expansion is not persisted. Only Pages and Media can filter. There is no `role=tree` except in Templates.
- Tabs: `sf-tabs`, the settings shell (`role=tab` links with no `aria-selected`), the admin shell, and custom tabs in
  generation and the media drawer.
- Dialogs: 25 components declare `role=dialog`, and none traps or restores focus. `DialogService` has no host, and
  bespoke overlays exist.
- There are 29 `window.confirm` calls and one `window.prompt` (rich-text link).
- There are no `canDeactivate`, no `beforeunload`, and no dirty check when switching templates or closing a global
  set. Only the media drawer asks before discarding.
- The context menu opens only from a mouse event: no keyboard, no arrow keys, no ⋮ alternative.
- `ShortcutService` has `g`-chords stubbed as a no-op. `?` opens the palette instead of a shortcut sheet. The palette
  is search-only.
- Bulk actions: complete only in Changes (the reference-quality list), delete-only in Media, and none elsewhere.
- Selection in the URL: Changes, audit and search keep it. Media, templates, navigation and globals strip it.
- Truncation favours the wrong text: tree names are cut while full UIDs show, and project names are cut while
  `PROJECT_ADMIN` badges show.
- Internal identifiers reach editors: record UUIDs as uids, `/pages_root/…`, navigation targets as UUIDs, template
  UUIDs in diffs, raw enums.
- Only 8 of 126 stylesheets have media queries. At 390 px the page editor can't be reached; at 1024 px the preview and
  the OCTL pane are clipped.

**Functional bugs** (see [M35.1](001-functional-bugs.md)).

**Largest components** (ts + html + scss, in lines):

| Component | Lines |
|---|---|
| media-detail-drawer | 1991 |
| templates | ~1900 |
| page-editor | 1606 |
| media-library | 1523 |
| settings-export | 1124 |
| changes | 1075 |
| settings-import | 1000 |
| generation | 993 |
| record-editor | 934 |
| dataset-schema-editor | 920 |

## Screen definition of done (applies to M35.16–M35.29)

- Built only from the design-system components (M35.6–M35.8). No raw hex, rgba or px literals outside
  `design/`, no inline `styles:`, and no `window.confirm` / `prompt` / `alert`.
- Lives in the app frame with a breadcrumb, a route title, exactly one `h1` and a correct heading order.
- Every string goes through Transloco (`en.json`).
- Identifiers follow decision 19. Status and enum values show as human labels.
- Has an empty state, a skeleton loading state and an error state (with retry where it makes sense).
- Keyboard walkthrough done: every action is reachable, focus is visible, and the screen's shortcuts are listed in the
  `?` sheet.
- Unsaved-changes guard and save indicator per decision 11.
- Selection and filters live in the URL (deep-linkable, and back/forward works).
- Screenshots reviewed in light and dark, compact and comfortable, at 1440 and 1024 (and 390 where review mode
  applies). Findings are fixed or listed in the task.
- `npx vitest run` and `npx ng build` are green (pre-existing warnings only).

## Phases and tasks

| id | title | phase | area | depends | status |
|---|---|---|---|---|---|
| M35.1 | [Functional bugs from the UX run](001-functional-bugs.md) | 0 groundwork | fullstack | — | done |
| M35.2 | [Decompose large components](002-decompose-large-components.md) | 0 groundwork | frontend | M35.1 | done |
| M35.3 | [User preferences API and client store](003-user-preferences.md) | 0 groundwork | fullstack | — | done |
| M35.4 | [Transloco setup and string extraction rules](004-i18n-transloco.md) | 0 groundwork | frontend | — | done |
| M35.5 | [Design tokens v2, theme and density](005-tokens-theme-density.md) | 1 design system | frontend | M35.3 | done |
| M35.6 | [Base components and form controls](006-base-components.md) | 1 design system | frontend | M35.5 | done |
| M35.7 | [Overlays: dialog, confirm, drawer, popover, menu, toast](007-overlays.md) | 1 design system | frontend | M35.5 | done |
| M35.8 | [Data table, tree and splitter](008-table-tree-splitter.md) | 1 design system | frontend | M35.6, M35.7 | todo |
| M35.9 | [Style guide and design gate](009-style-guide-gate.md) | 1 design system | frontend | M35.6, M35.7, M35.8 | todo |
| M35.10 | [App frame: top bar, rail, developer mode, titles](010-app-frame.md) | 2 frame | frontend | M35.2, M35.4, M35.9 | todo |
| M35.11 | [Information architecture: Publishing, Settings menu](011-information-architecture.md) | 2 frame | frontend | M35.10 | todo |
| M35.12 | [History drawer, full history, time-travel banner](012-history.md) | 2 frame | frontend | M35.10 | todo |
| M35.13 | [Save UX, unsaved guards, confirm and undo](013-save-guard-undo.md) | 2 frame | frontend | M35.10 | todo |
| M35.14 | [Keyboard-first: shortcuts, palette actions, `?` sheet](014-keyboard-first.md) | 2 frame | frontend | M35.10 | todo |
| M35.15 | [Recents and favorites](015-recents-favorites.md) | 2 frame | frontend | M35.3, M35.10 | todo |
| M35.16 | [Login, account and admin screens](016-login-account-admin.md) | 3 screens | frontend | M35.10, M35.13 | todo |
| M35.17 | [Content form and editors](017-content-form-editors.md) | 3 screens | frontend | M35.10, M35.13 | todo |
| M35.18 | [Pages: tree, folder table, page editor](018-pages.md) | 3 screens | frontend | M35.11–M35.15, M35.17 | todo |
| M35.19 | [Media library and detail](019-media.md) | 3 screens | frontend | M35.11–M35.15 | todo |
| M35.20 | [Content: record sets and records](020-content-records.md) | 3 screens | frontend | M35.11–M35.15, M35.17 | todo |
| M35.21 | [Templates IDE](021-templates.md) | 3 screens | frontend | M35.11–M35.15 | todo |
| M35.22 | [Navigation and globals](022-navigation-globals.md) | 3 screens | frontend | M35.11–M35.15, M35.17 | todo |
| M35.23 | [Changes, schedules and release dialogs](023-changes-schedules-release.md) | 3 screens | frontend | M35.11–M35.15 | todo |
| M35.24 | [Publishing, quality, redirects, URL registry](024-publishing-quality.md) | 3 screens | frontend | M35.11–M35.15 | todo |
| M35.25 | [Settings sub-pages, members, import/export](025-settings.md) | 3 screens | frontend | M35.11–M35.15 | todo |
| M35.26 | [Search page](026-search.md) | 3 screens | frontend | M35.14 | todo |
| M35.27 | [Tablet layout and review mode](027-responsive-review-mode.md) | 3 screens | frontend | M35.16–M35.26 | todo |
| M35.28 | [Dashboard 2.0 and project home](028-dashboard.md) | 4 extras | fullstack | M35.15, M35.16 | todo |
| M35.29 | [Preview upgrades](029-preview.md) | 4 extras | fullstack | M35.18 | todo |
| M35.30 | [Visual regression baselines](030-visual-regression.md) | 5 closing | qa | M35.27, M35.28, M35.29 | todo |
| M35.31 | [Journeys on the new UI](031-journeys.md) | 5 closing | qa | M35.27, M35.28, M35.29 | todo |
| M35.32 | [Spec §23/§24 and docs](032-spec-docs.md) | 5 closing | fullstack | M35.30, M35.31 | todo |

Parallelism:
- M35.1, M35.3 and M35.4 can start at once. M35.2 runs alongside M35.5–M35.8.
- M35.9 is a **hard gate**: no screen migration starts before the user signs off the style guide.
- Screen tasks M35.16–M35.26 can run in parallel, one agent per task. They must not edit each other's features.
  Shared components are changed only through their owning task, or with a note in both tasks.

## Out of scope

- Help menu, onboarding tours, documentation links in the UI (the `?` shortcut sheet is in scope).
- Shipping a second UI language (only the Transloco setup and `en.json`).
- Manual sibling ordering in trees, and new sort options.
- A phone-grade editing experience (below ~840 px is review mode only).
- axe-core gating.
- Grouping Changes rows per asset.
