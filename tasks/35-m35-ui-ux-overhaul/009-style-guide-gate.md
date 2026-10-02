---
id: M35.9
status: done
depends: [M35.6, M35.7, M35.8]
epic: m35-ui-ux-overhaul
feature: design-system
area: frontend
---

# M35.9 — Style guide and design gate

## Context

User decisions 24 and 25. This is a **hard gate**: no screen migration (M35.10 onward) starts before the user signs
off this task.

## Goals

- An in-app living style guide at `/styleguide`, visible to instance admins or in dev builds only. It shows:
  - Tokens: colours with contrast values, type scale, spacing, radius, elevation, z-index.
  - Every component from M35.6–M35.8 in all states, with a theme switch (light/dark) and a density switch
    (compact/comfortable).
- **One sample screen** built only from the components: a static mockup of the new frame with the Pages tree, a folder
  table and the page editor with its form and preview, using fake data.
- Screenshots of the style guide and the sample screen in light/dark × compact/comfortable at 1440 and 1024, shared
  with the user.

## Acceptance criteria

- [x] The user has reviewed the screenshots (or the running page) and **signed off**. Record the date and any
      requested changes below, and apply them before setting `done`.
- [x] `npx vitest run` and `npx ng build` green (218 files, 1,863 tests; build and lint green).

## User decisions (2026-10-01)

1. **Frame look:** a **dark top bar** (the darkest slate, in both themes — in dark theme below the page background),
   light rail and content.
2. **Rail:** the M35.5 layout tokens, 52 px collapsed / 232 px expanded (M35.10's 64 / 220 corrected); starts expanded,
   collapsible.
3. **Product mark:** a simple geometric icon (inline SVG, accent on the dark bar) plus the "StaticForge" wordmark;
   the icon is also the favicon.
4. **Sample screen:** a clickable prototype with fake data — tree → folder table → page editor (outline, form,
   realistic fake page in the preview, `sf-splitter`); menus, dialogs and the splitter work, nothing is saved.
5. **Style guide:** one `/styleguide` page with a sticky section index and the theme/density switches at the top.
   Chrome (headings, index, switches) through `styleguide.*` keys; demo labels and fake data as TypeScript data, no
   lint exemption.
6. **Review:** an Artifact gallery of screenshots plus the live page. Shots: style guide, sample folder view, sample
   page editor, sample editor view (developer mode off) — each in light/dark × compact/comfortable × 1440/1024, plus
   one collapsed-rail shot per theme. Screenshots are taken with headless Chrome (exact widths, full page);
   interactive checks in the user's Chrome.

## Review round 1 (2026-10-01): catalogs, cards, datasets, records and record sets were missing

7. **New components** `sf-card` and `sf-catalog` (an ordered list of cards), in the style guide in all states.
8. **Card look:** bordered panels with a header bar (drag handle, type icon, type · summary, collapse, ⋮ menu); nested
   cards are indented panels inside the body.
9. **Summary:** the card type plus the value of its first text-like field ("Product teaser · Yirgacheffe 250 g"),
   "Untitled" when empty.
10. **Adding:** an "Add card" menu button at the end with the allowed types, plus a "+" between cards on hover/focus to
    insert there.
11. **Card state:** cards open expanded; collapsing one is remembered per field for the browser session; "Collapse
    all / Expand all" in the catalog header.
12. **Sample:** the page editor gets a catalog field (with one nested catalog); the rail's Content item opens a content
    area (tree of folders and record sets, record set view, record editor).
13. **Record set filter:** a collapsed query panel with a readable summary; editors get a filter builder (field,
    operator, value rows), developer mode also shows the expression editor.
14. **Datasets:** under Templates (developer mode): a header, an overview tab (fields table; record sets using it) and
    the CDL / record-template tabs as code editors.

## Review round 1, continued (2026-10-01): a template view with CDL, OCTL and the code editor design

15. **Templates in the sample:** both the page template "Article" and the section template "Product teaser" (the
    catalog's card type), selectable in the templates tree: CDL (content, bodies, rules tabs) and the channel
    templates (html, rss) in OCTL in an `sf-splitter`, a settings section (output path, pagination), one deliberate
    diagnostic.
16. **Editor chrome, IDE-style:** a header strip per editor (file-like name, language, Format and Find), gutter with
    line numbers and fold markers, active line, bracket matching, squiggles, a diagnostics list below with jump to
    line, and a status line (Ln, Col, errors and warnings).
17. **Editor background follows the theme** (light editor in light, dark in dark).
18. **Two highlighting palettes to compare:** the current M35.5 `--sf-code-*` palette and one refined alternative
    (calmer, closer to the slate/blue UI), switchable in the sample and both in the gallery; the user picks one at
    sign-off.

## Review round 1, continued (2026-10-01): media library and media detail

19. **Media in the sample:** the rail's Media item opens a library — folder tree (`sf-tree`, folders only), toolbar
    (search, type filter, sort, grid/list toggle, Upload), grid and list (`sf-data-table`) views, selection with bulk
    move/delete (undo)/download, a drop zone over the whole area, and the per-file upload progress panel.
20. **Detail:** a resizable, non-modal `sf-drawer` on the right over the library; ←/→ step to the previous/next file.
21. **Tabs: all available** — Details (large preview, alt text, caption, file info, styled Replace; focal point set
    by clicking the preview, numbers in developer mode), Variants, Languages (a file per language), Processing (the
    "Process CMS syntax" switch of text media with its diagnostics), Rendered (the served output of text media),
    Source (text media in the code panel), Used by, Versions; tabs that don't apply to a file are not shown.
22. **Files:** photos (drawn inline), text media (a CSS file and an SVG logo), a PDF price list, and one image with
    a file per language (DE/EN). **Grid card:** thumbnail with the name (truncated at the end) and "JPG · 1.2 MB"
    below, checkbox top-left on hover/focus/selected, status icon when unreleased.

## Review round 1, continued (2026-10-01): navigation and globals

23. **Navigation reordering (widens decision 17, chosen by the user):** besides moving items into other folders, menu
    items can be reordered among their siblings — drag before/after and `Alt+↑/↓` in the tree. `sf-tree` gets this as
    an opt-in (`reorderable`, only with `sort="none"`); M35.22 needs a backend for sibling order (note added there).
24. **Navigation area:** the tree in navigation order with labels as "Company → /about-us/"; a selected menu folder
    shows an `sf-data-table` of its items (label, target page, public URL, visible in menu); a menu item's detail
    shows the target page as a picker card, and "Change target" opens the restyled page picker dialog.
25. **Globals area:** a tree of global sets with a filter; "Site settings" (site name, contact e-mail, opening hours
    as a list, social links as a catalog of cards, footer text localized with language chips) and "Shop settings"
    (currency select, shipping threshold); `sf-page-header` with save status; the Schema tab (CDL in the code panel)
    and the `$CMS_VALUE(CMS_GLOBAL…)` usage chip (`sf-copyable`) in developer mode only.

## Review round 1, continued (2026-10-01): changes and publishing

26. **Changes in the sample:** the one-row-per-language list (compact filter bar, chips only when active, selection
    and bulk Release / Discard / Schedule) with the diff pane open in an `sf-splitter`; the release dialog (changed
    languages pre-ticked, warnings needing explicit confirmation, a blocking error with an Open link); the schedules
    list (⋮ row actions, New schedule: release / unpublish / generation) and the schedule dialog (explicit title, kind
    switch); the shared release actions in the page editor header (replacing the release bar).
27. **Publishing in the sample:** runs table and a run detail (Summary | Rebuilt | Findings | Log, one run still
    running with a live log tail); the Build now dialog (target preselected, Full/Incremental, dry-run plan, page
    scope picker); targets (table, form in a drawer) and the publish policy form; quality (summary, rules by category
    with Off/Warning/Error), redirects and the URL registry (tables with aligned filters, destructive actions in ⋮ with
    a typed confirmation).
28. **Sub-navigation:** the Publishing sections (Runs, Targets, Policy, Quality, Redirects, URLs) use a **secondary
    side menu**, not page tabs.
29. **`sf-side-nav`:** that side menu is a design-system component (`shared/components/layout/`), shown in the style
    guide, and reused by Settings in M35.11.

## Review round 1, continued (2026-10-01): settings

30. **Quality, Redirects and the URL registry live in Publishing**, not Settings (M35.11 corrected): they are about
    what a build produces; Settings keeps the project's configuration.
31. **Settings in the sample:** General (name, description; archive in a danger zone), Languages (table, add/edit
    drawer, default and fallbacks), Channels (developer mode only; table, drawer), Import / export (steps: select with
    a checkbox tree, options, run, result; export button beside the selection summary). Media, Code highlighting,
    Compaction and Members are listed in the menu but not built in the sample.
32. **Settings menu** (`sf-side-nav`) is grouped: PROJECT (General, Languages, Channels, Media, Code highlighting),
    MAINTENANCE (Compaction, Import / export), PEOPLE (Members).

## Review round 1, continued (2026-10-01): editor width

33. **Editor forms span the full available width** of their pane (page, record, navigation item, global set): no
    centred, capped column. The splitter and the preview pane set the width; fields lay out in the form's grid.

## Review round 1, continued (2026-10-01): editor header

34. **Release actions vs. the page's ⋮:** the release actions are a group of their own in an editor header; spacing
    and a vertical divider separate their ⋮ (Unpublish, Discard changes) from the item's own ⋮ next to them.

## Review round 2 (2026-10-02): history (signed off 2026-10-02)

Added to the sample for M35.12 (`sample/history/`, `/styleguide/sample?area=history`, drawer `hdrawer=page|record|project`,
time travel `travel=86`). **Signed off by the user on 2026-10-02**; M35.12 builds it in the app.

35. **Drawers start below the top bar** (user, 2026-10-02): `sf-drawer` (non-modal) is offset by `--sf-topbar-height`; the
    bar's search, Build now and History stay usable. Applies to every drawer (also media, M35.19). Modal drawers still
    cover the viewport.
36. **History drawer, per context:** in an editor (page, record) it lists that item's versions — current on top, each with
    author name, relative time, a human summary, languages touched; actions *View* (time travel), *Compare with current*
    (field diff under the entry), *Restore* (confirm, then toast with Undo; not on the current version). Elsewhere it is
    the project timeline with author / type / date filters; entries name the changed items; actions *View*, *Details*.
    Footer: **Open full history**.
37. **Full history page** (`/p/:key/history`): `sf-data-table` timeline (revision, human summary, type, changed items by
    name, author + time), search and filters in the URL (`hfilter`), a revision opens in a splitter pane: its changed
    items by name with languages and field diffs (old −, new +), *Restore this item* per item, **View this state**,
    **Roll back project…** (danger, typed project key, lists what changes).
38. **Time-travel banner:** a calm strip under the top bar — "Viewing revision 86 · date · by Name", *Read-only* badge,
    **Back to now**, **Restore this state** (the same typed roll-back) — plus an accent frame around every screen.
    Screens are read-only meanwhile (the sample shows the frame; the app enforces it via `ProjectAccessStore`).
39. **Backend (decided with M35.12):** revisions get author name, languages touched and item names in the response, and
    `changeType` / from / to filters plus a total count; asset history gets author names and paging.

Changes the user asked for during the review (all in the signed-off sample):

40. **Date filter has a custom range:** presets Today / Last 7 days / Last 30 days and **Custom range…** (a dialog with
    From and To, either may stay empty; `range:custom,from:…,to:…` in the URL). The History drawer and the full page
    share one set of filter menus.
41. **Type filter shows the type's icon** (Edit, Release, Restore, Created, Deleted, Import); the chosen entry is named in
    the trigger and marked "Selected" in the list.
42. **The open row is highlighted:** `sf-data-table` gets `currentKey` — a row whose item is open beside the table gets
    the selection background (both themes), a leading accent bar and `aria-current` (not a selection). Reuse it for the
    other list + detail screens (Changes, Schedules, runs) when they are built.
43. **Filter-bar controls are as tall as the search field** (32 / 40 px by density): the shared `sf-data-table` toolbar
    (Filters, Clear filters, Columns), its toolbar slot, the Changes bar and History use the normal button size, not
    `sm`. Applies to every filter bar built from now on.
44. **Dialog footers:** `<ng-container sfDialogFooter>` (never a wrapping `<div>`), so the buttons are the footer's flex
    items and keep its gap. `sf-confirm` and the style guide demo were fixed.
45. **Top-bar build status:** icon and text sit in one flex row with a gap (sample and app).
46. **List + detail panes are bordered cards** of the same radius; the splitter's hairline is hidden
    (`--sf-splitter-handle: transparent`) and its handle sits centred in an 8 px gap (`--sf-splitter-gap`). Language tags
    in a detail pane sit close together.

## Review round 3 (2026-10-02): save, unsaved changes and undo (awaiting user sign-off)

Added to the sample for M35.13: Settings › General (name blank → *Not saved*), the page editor (blank title), the leave
guard through the rail, the tree and the settings menu, and the style guide (Display › Save status; Overlays › Unsaved
changes, large delete, undo variants). **Not signed off yet** — the app is built only after the user approves.

47. **`sf-save-status`** (in the page header, before the release group): *Saved 12:04* / *Saved* and *Saving…* are quiet
    muted text with an icon; *Unsaved changes* is a warning pill; *Not saved — 2 errors* (or *Not saved*) a danger pill.
    One polite live region that stays in place while the state changes. Explicit-save editors add a primary **Save**
    that is enabled only while dirty; autosave editors show only the status.
48. **Leave guard dialog:** "Unsaved changes — “<item>” has changes that are not saved yet." with **Discard** (danger
    ghost), **Cancel**, **Save** (primary, focused). A refused save keeps the person on the page: the dialog shows
    "Not saved — <why>. Fix it, or discard the changes." and Save becomes **Try again**. Escape and × are Cancel.
49. **Autosave editors:** leaving flushes a pending edit silently; the dialog appears only when the autosave cannot
    write (blank required field, rejected by rules, conflict). **Save now** (with the Ctrl+S hint) is the first entry of
    the ⋮ menu, disabled while there is nothing to save.
50. **Undo:** delete, move, rename and bulk variants show a toast with **Undo** (a bulk operation undoes as a group).
    A selection of **25 or more** items needs the word **delete** typed; smaller deletes confirm plainly and offer Undo.
51. **Scope of M35.13 (user, 2026-10-02):** infrastructure plus the page, record and template editors; Undo for every
    delete / move / rename that exists; the backend gets folder-subtree restore and restore for templates, page
    sections and UID changes.

## Review round 4 (2026-10-02): command palette and `?` sheet (signed off 2026-10-02)

Added to the sample for M35.14 (`sample/keyboard/`; `/styleguide/sample?cmdk=` and `…&cmdk=%23gen` for the palette,
`…&sheet=1` for the sheet; Ctrl/Cmd+K and `?` work in the sample too). **Signed off by the user on 2026-10-02**; M35.14 built the app's palette and sheet as signed off.

52. **Palette:** a modal combobox, 42rem wide. Groups: *Actions* (those that fit what is open), *Navigate* (every screen,
    then settings pages while typing), *Recent*, *Favorites*, *Search results* (needs 2+ characters, capped at 4).
    Without text: five context actions, Recent, Favorites, then the screens. Fuzzy matching, matched characters
    underlined; key hints on the right; the selected row is highlighted with the focus ring. Entries a person may not use
    are left out (Templates, Channels and *Go to Templates* need developer mode; release needs an open page or record).
53. **Prefix modes:** `>` actions only, `#` settings pages, `@` projects. The prefix becomes a chip before the box
    (Actions / Settings / Projects); Backspace on an empty box leaves the mode. *Switch project…* enters `@`.
54. **`?` sheet:** the shortcuts of the open screen first (badge *On this screen*), then *Everywhere*, *Go to* and
    *Publishing*; a search field filters by description or keys. In the app it is generated from the registry.
55. **Browser-reserved keys (user, 2026-10-02):** History **Alt+H**, Release **Alt+Shift+R**, Build now **Alt+Shift+B**
    (Ctrl+H, Ctrl+Shift+R and Ctrl+Shift+B belong to the browser).
56. **Scope (user, 2026-10-02):** M35.14 builds the registry and every set in its Goals list, including table keys
    (↑/↓, Space, Enter, Shift, Ctrl+A), release and build; actions are registered by the services and screens that own
    them (registry-driven), permission-checked through `ProjectAccessStore`.

## Review round 5 (2026-10-02): recents and favorites (awaiting user sign-off)

Added to the sample for M35.15 (`/styleguide/sample?area=pages&view=folder`; the editor star is on `view=editor`). **Not
signed off yet** — the app is built only after the user approves.

57. **Favorites mark (☆):** in the page editor header (as before), in the **Pages tree's context menu** (*Add to favorites* /
    *Remove from favorites*, also Shift+F10) and in the **table's name cell** — a star button that shows on hover and
    focus of the cell and stays, in the warning colour, while the item is a favorite. A toast confirms the change. The
    palette gets the context action *Add to favorites* / *Remove from favorites* for the open item.
58. **Favorites are not store-bound (user, 2026-10-02):** a favorite can be any asset — page, record, template, media file,
    global set, navigation item — and the same list shows in every tree. The pinned first node *Favorites* (star; only while
    there are favorites) sits at the top of every tree (Pages, Content, Templates in the sample; Media, Navigation and Globals
    the same) and lists them all as flat shortcuts with an icon per kind and where they live as the secondary text; a child
    opens the item in its own area. **Clicking the node itself opens the Favorites list** in the main pane, whichever area
    is open: a table (Name with the star to remove it, Type, Location) of the favorites from all stores; a row opens the
    item. **Folders are favoritable too** (tree context menu, the folder view's header menu, the table star) and show as
    folders — in the *Favorites* branch and in the list: a favorite folder expands lazily (as the folder itself would,
    sub-folders included, whichever store it belongs to) and a row or node opens the folder in its own area. Nothing in the
    branch can be renamed, deleted or created. `sf-tree` gets `pinned` on a node (sorts before its siblings whatever its label).
59. **Recents and favorites in the palette** follow the same lists (empty state: context actions, Recent, Favorites,
    screens). Recent holds what was opened last, newest first, deduped.
60. **Scope (user, 2026-10-02):** assets only (no settings pages); stale entries are dropped when a list shows (resolved
    through the API), and again on open; the project home and dashboard blocks stay with M35.28.

## Review round 6 (2026-10-02): login, account and administration (signed off 2026-10-02)

Added to the sample for M35.16 (`/styleguide/sample?area=login|setpassword|account|admin`; `lstate`, `pstate`, `acsec`, `acstate`,
`asec`, `adetail`, `astate`, `ufilter`, `pfilter`, `afilter` for review states). **Signed off by the user on 2026-10-02**; M35.16 builds it in the app.

61. **Login and Set password** (outside the frame): one centred 24 rem card on the page background — mark and wordmark, `h1`,
    a muted lead, the form, small print below the card. The primary button spans the card and stays disabled until the
    fields are filled (the tooltip says why); while signing in it shows a spinner and "Signing in…". A refused sign-in is an
    inline assertive danger banner above the fields, cleared on the next edit. Show/hide password is a ghost icon button with
    `aria-pressed`. No implementation text ("tokens are kept in memory only" is gone).
62. **Password rules:** a live plain-language checklist (12 characters, a letter, a digit or symbol, both match) that is
    neutral while its field is empty, ✓ when met and ✗ only after typing. The length limit is counted in **characters** (72),
    never bytes, and appears as a line only when exceeded ("That is 90 characters; the limit is 72."). Set password stays
    disabled until every rule is met.
63. **My account** (no rail, top bar stays): `sf-side-nav` with Profile, Password, Preferences, My projects, Sessions — one section
    per page, `acsec` in the URL; a section with unsaved edits shows an *Unsaved* badge and leaving it goes through the leave
    guard. Profile and Password use the explicit-save area (status, Discard, primary Save enabled only while dirty); changing
    username or email reveals *Current password*. Preferences (theme, density, developer mode, read-only language "English")
    apply immediately, no Save. My projects: a table with the person's **human role label** (Viewer, Editor, Release manager,
    Developer, Project admin) and an Open button, with skeleton, error (Try again) and empty states. Sessions: only *Sign out
    of all sessions* (secondary, confirmation, toast) — the backend cannot list sessions.
64. **Administration:** the rail is the only navigation (Users, Projects, Jobs, Audit; no Settings footer). Breadcrumb
    Administration › Section › Item. Every list has the shared skeleton, empty ("No users match." + Clear filters) and error
    (Retry) states; filters live in the URL.
65. **Users:** search, Status and Role menus, *Show deleted* (off by default); roles and statuses in words (Instance admin / User;
    Active, Disabled, Locked, Deleted); last sign-in as relative time; *Password change pending* as a warning badge. *New user*
    dialog (username, name, email, role; generate a one-time password or set one) shows a generated password once, with a copy
    button. A row opens the user. **Row ⋮ menu (user, 2026-10-02): Edit user** (opens the detail) and Sign out everywhere
    (confirmation + toast); no danger item in the list's menu — Delete user stays in the detail.
66. **User detail:** **Disable** (Enable / Unlock) is a secondary button with a toast and Undo; the header ⋮ menu holds Reset
    password…, Sign out everywhere, Make / Remove instance admin and **Delete user** — the menu's only danger item, which asks
    for the typed username and offers Undo. Profile (explicit save + guard), Account facts, Project memberships (role select
    with human labels, remove with Undo, *Add to project*). A deleted user is read-only.
67. **Projects:** search and *Show archived*; **New project** (primary, dialog: key validated as you type, name, description);
    row ⋮ menu: **Edit project…** first (name and description; the key is read-only), Open project, Archive (confirmation + Undo) or
    Unarchive. Archived rows are muted and the status says it in words.
68. **Jobs:** the schedule in words ("Every day at 03:00 (Europe/Berlin)"), cron only as a tooltip (developer mode in the form); an
    enabled switch per row; last run with a human outcome (Succeeded / Partly succeeded / Failed / Skipped) and a *Dry run* badge;
    a job whose code is gone is muted ("No longer installed"). **Row ⋮ menu: Edit schedule** (opens the detail) and Run now (disabled for a job that is gone). **Job detail:** *Run now* and *Dry run* (secondary), the schedule
    form (explicit save + guard) and a paged run history; a run opens a report.
69. **Audit:** a **multi-select combobox** for human action labels, a user combobox, a project select and an **inline From / To
    date range**; the controls are as tall as the search field (decision 43); filters in `afilter`; time as relative time with the
    absolute time in the tooltip; paged.
70. **Two-line cells (user, 2026-10-02):** a name over an identifier or description is the new design-system cell
    **`sf-table-identity`** (name in medium weight with its badges set apart, the muted line below, optional avatar, `mono` for
    keys) and the table gets **`twoLine`**, which gives those rows the height they need. Used for Users, Projects, a user's project
    memberships, Jobs and the import conflicts; every future multi-line cell uses it.
71. **Clickable rows show the pointer (user, 2026-10-02):** `sf-data-table` rows get `cursor: pointer` by default (`rowsOpenable`,
    off with `[rowsOpenable]="false"` where a click does nothing) — in every table, in the app and the sample.

## Notes / hazards

- Sign-off: **signed off by the user on 2026-10-01** — gallery https://claude.ai/artifact/33yY26sd6H17UTP9sPPJid
  (version 4: 198 headless-Chrome screenshots of 45 screens) plus the live pages `/styleguide` and `/styleguide/sample`.
  Changes requested during review (all applied before sign-off): decisions 7–34; editor forms full width (33); the
  release actions' divider (34); catalog fields framed like sections; the outline jump no longer shifts the frame
  (`.sf-sr-only` pinned to its containing block); 12 review findings in the design-system code fixed.
- Open after sign-off (not decided at the gate, current behaviour stays until decided):
  - **Code highlighting palette** (decision 18): Current vs Refined was not picked. The current M35.5 palette stays the
    default; Refined stays available via `data-code-palette="refined"`. Decide before M35.21 (templates IDE).
  - **Drawers over the top bar — decided 2026-10-02 (decision 35): drawers start below the top bar.** (`sf-drawer` used
    to cover the dark top bar, seen on the media detail.)
