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
    shows an `sf-data-table` of its items (label, target page, public URL, visible in menu — see decisions 168–171); a menu item's detail
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

## Review round 3 (2026-10-02): save, unsaved changes and undo (signed off 2026-10-02)

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

## Review round 5 (2026-10-02): recents and favorites (signed off 2026-10-02)

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

## Review round 7 (2026-10-02): content form and editors (signed off 2026-10-02)

Added for M35.17: a **Content form** section in the style guide (`/styleguide#sg-contentForm`: findings, language chip switch, the
two-column demo and all 19 editors in four states each) and richer sample editors (`/styleguide/sample?area=pages&view=editor` —
*Preview* off shows the two columns — and `?area=content&view=record`). **Signed off by the user on 2026-10-02**; M35.17 builds it in the app. Added at the
review: the picker's type switch includes **Navigation entries** (the Navigation store) and types without a folder tree use the full dialog width.

72. **Field shell:** every editor sits in `sf-field` — label, required marker, hint, findings under the control, optional tags on
    the label line. Findings come at four levels (error, warning, info, hint; this order); an error-level finding marks the control
    invalid. New design-system pieces: `sf-finding` (icon, message, spoken level word; `role="alert"` for errors) and `sf-field`
    inputs `findings`, `empty`, `tags` and a label addon slot.
73. **A required error shows once:** the client "required" message is left out when a rule already reports an error for the field.
74. **Language chip** (user, 2026-10-02): inline right of the label; the editing language ("English") or "All languages" for a shared
    field; nothing when the template or dataset is not localized.
75. **Read-only and computed:** computed fields are read-only with an info *Computed* tag and a hint that the CMS fills them in;
    plain read-only fields use a dashed border and a "locked" hint — both readable, never greyed out.
76. **Rich text** (user: current set + numbered list + clear formatting): `role="toolbar"` with Bold, Italic, H2, H3, bullet list,
    numbered list, quote, Link, Clear formatting (each switchable per field), `aria-pressed`, tooltips naming the shortcut, one tab
    stop with arrows / Home / End; **Alt+F10** focuses the toolbar, Escape returns to the text; Ctrl+B / Ctrl+I / Ctrl+K.
77. **Link dialog** replaces `window.prompt`: address, *Choose a page…* through the picker, *Open in a new tab*; Apply disabled
    until the address is valid.
78. **Media editor:** a drop zone while empty; filled, a thumbnail card (name, dimensions, Replace, Remove) and the alt-text field with
    a warning while empty. The UUID only in developer mode, copyable.
79. **Reference and link editors** show the target's name and URL with Open, Change, Remove (a link is a page or a web address); no
    UUIDs. They, the media field and the rich-text link dialog pick through the **asset picker** — the current picker's functions
    and layout in the new design (user, 2026-10-02): one large dialog with a toolbar (type switch — only the types the field
    allows, hidden for a single type; dataset select for records; debounced search with a result count), a **folder tree** on the
    left ("All …" root, lazily opened folders, a breadcrumb; searching ignores the folder filter) and the results on the right (icon
    or thumbnail, name, dataset badge, record count for record sets, status badge, format and size for media, folder path — the uid
    only in developer mode —, indented Navigation folders); pagination sources (navigation folder / dataset) only when the field names
    them; a footer naming the selection with **Cancel** and **Choose** (disabled until a row is selected); ↑/↓/Home/End, Enter or
    double click to choose, loading skeleton, per-type empty state and an error state with Retry; narrow, the tree becomes a folder
    select.
80. **Lists and groups:** add, remove with an Undo toast, drag by handle and **Alt+↑/↓** (focus stays on the moved handle, polite
    announcement); groups are collapsible with a summary line while closed.
81. **Two columns are opt-in per field in the template** (user, 2026-10-02): a new CDL attribute `width: half` (full is the default);
    fields marked half flow two per row in the original order, everything else spans the row. The rule follows the form's own
    width (two columns from 46 rem — about 1280 px with no side pane), so beside the preview pane the form stays one column.
    Backend: the CDL lexer/parser/validator and the compiled definition get `width`.

## Review round 8 (2026-10-02): pages — settings, issues, section palette, empty states (signed off 2026-10-02)

Added to the sample for M35.18 (`/styleguide/sample?area=pages&…`: `view=editor&psettings=page`, `view=folder&psettings=folder`,
`view=editor&issues=1|empty`, `view=editor&secpalette=1`, `empty=1`, `view=editor&preview=incomplete`). **Signed off by the user on 2026-10-02**; M35.18 builds it in the app.

82. **Page settings = a non-modal drawer** (user, 2026-10-02), below the top bar, from a header settings button (reflects open state) and
    *Page settings…* in the ⋮ menu. Name and UID changes apply at once with an Undo toast (the UID — developer mode only — warns that links
    to the page break); navigation settings (show in navigation, label, position, hide from search engines) save with the page (footer
    "Saving… / Saved", no Save button); a read-only block shows template, address and last change.
83. **Folder settings** use the same drawer from the folder's ⋮ menu: start page (picker, Change…, Remove), navigation settings, path and
    contents facts — nothing above the title.
84. **Issues = a header drawer** (user, 2026-10-02) opened by a count button in the page header: grouped by level (Errors, Warnings, Info,
    Hints) with counts, a "Checked when" filter (editing / saving / releasing / building) with a plain-language legend, each finding with
    where it is, whether it is a content rule or an output check, content-or-template fix, and *Go to it*; the check code in developer mode
    only; the old "Impact as of now" is **"Pages affected by this change"**, a collapsible section at the bottom.
85. **The outline marks sections with findings** (icon of the most serious level + screen-reader text).
86. **Section palette** (user: icon tile per template): a dialog from *Add section* and from a "+" between sections (hover/focus): insert
    position named, filter field focused, categories with counts, icon tiles (name, category, description; a slot for a future
    thumbnail), a template at its maximum disabled ("Maximum of N reached"), ↑/↓ move, Enter inserts, Esc closes, no-match state with
    *Clear filter*.
87. **Empty project:** says a page needs a template; developers get *Go to Templates*, editors are told to ask a developer (no dead
    button); *Create a folder* always offered.
88. **Incomplete-page preview:** an explanatory state instead of a blank frame — what is missing and a *Go to <field>* button.
89. **Bulk move and duplicate** in the folder table show toasts with Undo (move target is a placeholder until a move picker exists).

## Review round 9 (2026-10-03): media — states, file actions, uploads, guards, text-media source (signed off 2026-10-03)

Added to the sample for M35.19 (`/styleguide/sample?area=media&…`). **Signed off by the user on 2026-10-03** (decisions 90–106) — M35.19 builds the app from it. Favorites in media are not part of this round (they follow the Pages design, decisions 57–58).

Review links (all combine with `media=grid|list`, `folder=<id>`, `asset=<id>`, `mtab=…`; `dev=0` hides developer mode):

| Param | What it shows |
|---|---|
| `tfilter=<text>` | the folder tree's filter; `tfilter=zzz` is the no-match state with *Clear filter* |
| `state=loading` / `state=error` / `state=empty` | skeleton (grid, list, tree) / error banner with Retry (Retry returns to normal) / library with no folders and no files |
| `q=<text>`, `type=images\|documents\|text`, `sort=name\|date\|size\|type` + `-asc\|-desc` | search, type filter and sort in the URL (`sort=size-desc`); defaults are left out |
| `dialog=rename` / `move` / `folder-move` / `delete` | opens that dialog on the open file, the selection or the first file (`asset=a-latte-rosetta&dialog=rename`) |
| `menu=<fileId>` | opens that file's menu (`menu=a-latte-rosetta`); right click, Shift+F10 and the ⋮ button work by hand |
| `asset=a-yirgacheffe-beans&dirty=1` | the drawer with unsaved edits: step ←/→, click another folder or close it to get the leave dialog |
| `upload=1` / `upload=errors` | the panel mid-upload / every kind of refusal and a finished picture asking for alt text |
| `folder=m-archive&selected=30` (add `&dialog=delete`) | 30 files selected in the new *Archive* folder (32 generated photos): the typed delete confirmation; `selected=24` confirms plainly |
| `asset=a-hero-texture` (PNG), `a-yirgacheffe-beans` (JPG) | the focal point rule; developer mode adds hash, media type and storage path |
| `asset=a-brand-css&mtab=source` (CSS), `asset=a-logo&mtab=source` (SVG) | the Source tab of a text file (decisions 102–106) |
| … `&complete=1` | the text ends with an unfinished `$CMS_VALUE(#global.br`: click into the editor, Ctrl+End, **Ctrl+Space** to see the project names (102) |
| … `&highlight=auto\|css\|javascript\|json\|xml\|markdown\|plain` | the project's override of the open file's type, as if picked from the *Highlighted as* menu (104) |
| … `&banner=large\|utf8\|eol` | too large to edit (editor replaced by the banner) / not valid UTF-8 (text with �) / mixed line endings (105) |
| … `&lang=de\|en` | the file has one file per language: the Source tab shows the Language select on that language (105) |
| `?` sheet | on the media area it lists the media shortcuts |

90. **Folder tree filter:** a filter field under the *Folders* head filters the folders client-side — a folder stays when its name matches or a folder
    below it does, and the folders on the way open. No match: "No folder matches “x”" with *Clear filter*. URL `tfilter`. (The shared `sf-tree`
    filter is switched off here; the app either reuses it and adds a *Clear filter* action to its no-results state, or builds this field.)
91. **Review states** (`state`): a skeleton for the grid (cards of the grid's own shape), the list (`sf-data-table` loading) and the tree; an error
    banner with **Retry** above an empty grid / the table's banner / the tree's "Couldn’t load this tree" with Retry — any Retry returns the whole area
    to normal. **Empty library** (no folders, no files): title "Your media library is empty", explains what to do, **Upload** + **New folder**; the
    tree says "No folders yet" with **New folder**; the toolbar is hidden. The existing empty folder and no-match states stay.
92. **Per-file actions:** one menu — *Open, Rename…, Move…, Download, Copy link, Delete…* (danger, after a separator; shortcuts shown) — on a grid
    card (right click, **Shift+F10** / menu key, and a **⋮ button** that shows on hover and focus and is not a tab stop while hidden), on a list row
    (right click, Shift+F10, a **⋮ column**) and in the drawer's ⋮ menu (which adds *Rename…* and *Move…* to Replace, Download, Copy link, Delete…).
    On a file that is part of a multi-file selection the menu acts on the selection (*Move N files…, Download N files as ZIP, Delete N files…*).
    **F2** renames and **Delete** deletes (the selection when the file is in it). The status icon of a card moves to the end of the meta line.
93. **Rename dialog:** one name field, checked as you type — required, no `/ \ : * ? " < > |`, at most 100 characters, the **extension stays**, the name is
    not taken in the folder; *Apply* is disabled until the name is valid and changed; Enter applies. An Undo toast follows.
94. **Move dialog** (one for bulk Move, a file's *Move…*, the page header's *Move folder…*): a folder tree to pick from; the current folder is shown
    with "Current folder" and cannot be chosen; for a folder, itself and what lies inside it ("Inside the folder being moved") are blocked and the
    top level is offered; *Move* is disabled until a target is chosen. **Dragging cards onto a tree folder** moves them (the row highlights; the
    folder they are in refuses). Every move shows a toast with **Undo** (a group undoes together); moving the open file closes the drawer.
    **Folder create and rename stay inline in the tree** (as the tree already does; the page header's *Rename folder* starts the inline edit),
    no dialog. In the sample a folder move is announced and undoable but the sample's folder tree does not change.
95. **Download:** one file downloads as itself; several files as **one ZIP named after the folder** (`products.zip`). The sample shows it as a toast
    (read out by screen readers) that says nothing is downloaded.
96. **URL state for the library:** `q`, `type`, `sort` (`<field>-<asc|desc>`) join `media`, `folder`, `asset`, `mtab` and `selected`; defaults are
    omitted; back/forward and deep links restore them. The tree filter is `tfilter`.
97. **Unsaved changes in the drawer:** the footer shows `sf-save-status` (*Saved 12:04* / *Unsaved changes*) with *Revert* and *Save* (decision 47);
    stepping to another file (←/→ or the buttons), clicking another file, switching folder (the drawer then closes), closing the drawer and leaving the
    area through the rail all raise the shared leave dialog (decision 48: **Discard / Cancel / Save**). A clean drawer never asks.
98. **Uploads panel:** the header names the target ("Uploads to Products"; "to N folders" when mixed). A refused file says why and offers what fits:
    *type not accepted* (list of types) → Remove; *too large* ("24.6 MB is over the limit of 10 MB per file") → Remove; *name already exists in
    <folder>* → **Replace** (links and usages stay) / **Keep both** (`name-2.jpg`) / Remove; *connection lost* → **Retry** / Remove. Retry exists
    only for a lost connection. A finished picture asks for **alt text inline** (field + *Save*, then "Alt text saved") and has an *Open details* icon.
    Chosen and dropped files are checked for real (type, 10 MB, name).
99. **Large delete:** a selection of **25 or more** files needs the word *delete* typed (decision 50); fewer confirm plainly. Both offer Undo.
100. **Keyboard:** the `?` sheet lists, for the media area — grid: arrows, Home, End, Space, Ctrl+A, Enter, F2, Shift+F10, Delete; drawer: ←/→ (focus in
    its header), Esc; focal point: arrows (1 %), Shift+arrows (10 %); tree: expand, collapse, F2.
101. **Focal point is for photos (JPG) only** — PNG and SVG pictures, PDFs and text files get none; the Details tab says so (a note under the
    preview, and in the photo's hint/description). In developer mode the Details tab additionally lists **media type, hash (SHA-256) and storage
    path** (copyable) next to the UID and path.

Source tab of text media (decisions 102–106, **signed off 2026-10-03**; added 2026-10-03 to bring the sample level with the app's
`MediaDrawerSource` and then past it — the app's Source tab has none of the *new* items 102, 103 and 104):

102. **Completion of project names in the Source tab** (CSS and SVG): inside an instruction (`$CMS_VALUE(`, `$CMS_REF(`) **Ctrl+Space** offers the
    project's **global values** (`#global.brand.roastColor`, `#global.brand.accentColor`, …), **media UIDs** (`media:hero_texture`) and **page paths**
    (`page:/shop`) besides the OCTL words. A reference is matched as a whole, so `#global.br` completes to `#global.brand.roastColor` (a small fix in the
    shared OCTL completion; before, only the last word of a dotted or slashed name matched). The app passes the names from the project's globals, the media
    library and the page tree (`sf-code-editor [names]`; `sf-code-panel` gains the same input). A hint line under the panel says so. The sample offers
    `brand.accentColor` and not `brand.accent`, which the Processing tab's warning says does not exist.
103. **SVG-aware completion:** an SVG file's Source (and Rendered) passes `svg`, so inside the text `<` completes SVG elements and attributes; SVG and CSS
    highlight in both tabs and in the Details preview of a text file (CSS as CSS, SVG as XML). The Details tab of an SVG keeps showing the picture.
104. **Highlight override:** the Source panel header carries a **Highlighted as <format>** button (the panel's new `sfCodePanelTools` slot) opening a
    menu *Auto · CSS · JavaScript · JSON · XML · Markdown · Plain text* under the heading **“Project setting for .css files”**; Auto says what it detects.
    Choosing re-highlights Source, Rendered and the Details preview at once and announces that every file of that type in the project is now highlighted
    that way. In the app it writes the project's `codeHighlighting` override by extension (the MIME-type override stays settings-only). Open: whether
    editing project settings from the drawer needs the settings permission (the menu is disabled with a reason without it).
105. **Source banners and language:** *too large to edit here* (the editor is replaced by the banner with **Download** and **Replace file**), *not valid
    UTF-8* (unreadable characters shown as �, saving stores UTF-8), *mixes line endings* (saving stores LF) — wording as the app's; and, for a text
    file with one file per language, a **Language** select above the panel that switches the file being edited (unsaved edits raise the leave dialog).
106. **Popups stay over the editor:** inside `sf-code-panel` the hover tooltip and the completion list are confined to the editor (they flip above the line
    near its bottom) instead of covering the Problems list and the status line below it (CodeMirror `tooltipSpace`, set in the shared setup). Editors outside
    a panel keep the whole window. Not done on purpose: highlighted text snippets on grid cards — they are a static `<pre>` and a highlighted one needs the
    editor's lazily loaded grammars; the card keeps the plain snippet.
107. **Rename dialog carries the UID in developer mode, files and folders; F2 in the tree stays inline** (user request 2026-10-03, after the sign-off of
    this round; not in the sample). The Rename dialog (decision 93) gets a *UID* section in developer mode with the same control as the page settings
    (decision 82/19: `sf-uid-rename`, links to the item break, Undo toast); it changes the UID on its own, apart from the name's Apply. Folders get the
    same dialog (*Rename…* in the tree's menu, *Rename folder…* in the page header's ⋮); F2 in the tree remains the in-place name edit as signed off.

## Review round 10 (2026-10-03): content — the New record set dialog (signed off 2026-10-04)

Added to the sample for M35.20 (`/styleguide/sample?area=content&view=contentfolder`; `&newset=1` opens the dialog on arrival; it also opens from the
folder header's *New record set*, the tree's *New* menu and a folder's context menu). **Not signed off yet** — the app keeps its current
`sf-create-asset-dialog` (the first dataset preselected) until the user approves; M35.20 builds the new dialog only after sign-off.

108. **New record set dialog:** a modal `sf-dialog` (md) with **Name** and **Dataset**. **No dataset is preselected**: the select shows the
    placeholder *Choose a dataset*. **Create** is disabled until a name *and* a dataset are given and, being disabled, says why in its tooltip
    (*Choose a dataset first.* / *Enter a name first.*). A missing name is called out ("A name is required.") only once the field was touched.
    Enter creates; Escape, × and Cancel close without a result. The UID is not asked for (the server derives it from the name).
109. **The dataset is permanent, and the dialog says so:** the hint under the select reads "Every record in the set has this dataset’s fields.
    The dataset can’t be changed after the set is created." (replaces the app's hint, which only appeared beside an already chosen dataset).
110. **Where it opens from:** the folder view's header *New record set*, the tree's *New* menu entry and — new — a **folder's context menu** entry
    *New record set*. The tree's own inline create row now makes **folders only** (a set needs a dataset, so it is no inline item); in the
    sample the entry still only announces what would happen (nothing is saved).

## Review round 11 (2026-10-03): content — what the real M35.20 screens do beyond the signed-off sample (signed off 2026-10-04)

Added to the sample for M35.20 (`/styleguide/sample?area=content&…`). **Not signed off yet** — M35.20 built these in the app while the sample lacked them (a slip
against the sample-first rule); the sample now shows exactly what the app does, so the user can review it. Where a decision here is changed or refused, the app screen
changes to match. Nothing in this round is saved: dialogs and menus announce what they would do, records move and delete in memory with Undo.

Review links (all combine with `dev=0`, which hides developer mode):

| Param | What it shows |
|---|---|
| `view=contentfolder` | the folder table with its new *Status* column; `&dialog=rename` / `move` / `bulkmove` opens that dialog (on the open folder; `bulkmove`: its first two entries) |
| `view=recordset&show=all` | the record table on *All records*, the records the filter leaves out dimmed and marked |
| `view=recordset&filter=extras` | the *Roastery tours* set: a date and a Yes/No condition, two sort keys, a limit (add `&show=all` to see *Spring cupping* marked as left out) |
| `view=recordset&filter=custom` | a set that stores `roast == 'dark' \|\| stock > 50`, which the builder cannot show |
| `view=recordset&dialog=rename` / `move` / `bulkmove` | the Rename dialog, the folder Move dialog, the records Move dialog (with the two preselected records; with `filter=extras` the "nowhere to move" state) |
| `view=recordset&panel=usedby` | the record set's *Used by* drawer |
| `view=record&panel=checks` / `panel=usedby` | the record editor's *Checks and usage* drawer on either tab |
| `view=record&state=deleted` / `notfound` / `revision` / `error` | the deleted-record banner with *Restore*; *Record not found*; *Not there yet* (no such revision); *Could not load the record* |

Sample data added for this round: the *Events* dataset gets a **Date** and a **Sold out** (Yes/No) field (new field types *Date* and *Yes/No*), and the *Roastery tours* set
a fourth tour (*Spring cupping*, in the past, sold out) and a stored filter that uses them.

111. **Folder table: Status column.** After *Records*: a chip per language (`DE`, `EN`) with the release state in its tooltip — *Released* when everything inside is,
    *Draft* when nothing is, otherwise *Changed*. A folder combines the records of every set inside it. (The sample's table had Name, Dataset, Records, Modified.)
112. **Record set: Shown by the filter / All records.** A two-segment control in the table's toolbar (*Records shown*). The default, **Shown by the filter**, lists
    the records the set's *saved* filter selects, in its order. **All records** lists every record; the ones the filter leaves out are dimmed and carry a crossed-eye
    icon, with the tooltip and screen-reader text "Not shown on the site: the filter leaves this record out." (`?show=all` in the app.)
113. **Filter panel extras.** (a) **Skip first** and **Show at most** number fields (empty = none); the one-line summary adds "· skipping the first 2 · at most 10"; when they
    cut the list the count reads "3 of 4 records · the set shows 2". (b) **Several sort keys:** "Sort by … / then by …" rows, each with a field (a field another key uses
    is taken), an ascending/descending toggle and *Move up*, *Move down* and *Remove* buttons; *Add sort key*; without a key the default order (by name) is said.
    The summary reads "sorted by date, then price (descending)". (c) **Typed value controls:** a **date picker** for a date field (operators *is*, *is not*, *is after*,
    *is before*) and a **Yes/No select** for a yes/no field (operator *is* only).
114. **A stored expression the builder cannot show** (`||`, groups, functions, an unknown field): the builder steps aside. The panel says "This filter is an expression
    the builder can't show, so it stays as it is. Clear it to build a filter here.", quotes the expression (in developer mode the *Expression* field shows it, otherwise
    it is printed in the panel), the summary quotes it in monospace, and **Clear filter** returns to the builder with no conditions (an unsaved change). Sort keys,
    offset and limit stay editable.
115. **Edits are a draft: Save filter / Revert.** The panel's edits show an **Unsaved** chip beside the summary; the count follows the draft at once, the table follows
    only the *saved* filter. **Save filter** keeps the draft, **Revert** returns to the saved one (both disabled without a change).
116. **Use as set filter** in the table toolbar (after the mode control). Developer mode adds the table's own **Expression filter** (a field with *Apply* and *Clear*;
    an expression the sample cannot read is marked invalid). The button is disabled until the table has an expression or a header sort; it then copies the expression
    (as builder rows, or as a stored expression when it has `||`) and the header sort (as sort keys) into the draft filter, opens the panel and leaves it **Unsaved**.
117. **Record set ⋮ menu:** *History*, *Used by* (a drawer), *Rename…*, *Move…*, then *Delete…* (the sample's *Duplicate* is gone — the app has none). *Used by* lists
    the pages, templates and records that read the set (type badge, name, path), or says "Not used yet". *History* opens the history drawer (fake data); *Delete…* is
    still only announced.
118. **Rename dialog** for a record set or folder (also *Rename…* of a folder's ⋮ menu): a **Name** field with **Save** (disabled until changed; a blank name is refused)
    and, in developer mode only, a **UID** section with its own **Change UID** (decision 107; an Undo toast follows). F2 in the tree stays the in-place name edit.
119. **Move dialog for a set or folder** (the ⋮ menus' *Move…*, the table's bulk *Move*, the tree's *Move to…*): the folders as a tree, the top level ("Content") first;
    where the item is now is marked "Current location" and a moved folder with what lies inside it "Inside what you are moving" — neither can be chosen. **Move** is
    disabled until a target is chosen, saying why. Afterwards "Moved … (prototype — nothing was moved)." with an Undo.
120. **Bulk Move of records** (the record table's selection bar, and the record editor's *Move…*): a dialog "Move 2 records to…" with a list of the **other record sets of
    the same dataset** (a record cannot leave its dataset; each entry says which folder it is in). With none: "There is no other record set of this dataset to move to."
    **Move** stays disabled until one is chosen. The records move in memory ("Moved 2 records to Espresso blends.") and **Undo** moves them back.
121. **Folder ⋮ menu:** *Rename*, *Move…*, *Delete…* — **no *Used by*** (folders have none, so the sample's entry is dropped) and **no menu at all at the top level** of the store.
122. **Tree menu:** the one menu also has **Cut**, **Paste** and **Move to…** (the folder Move dialog; a drag only announces the move with an Undo). A record set's menu adds
    **New record**, **History** and **Used by** (before *Add to favorites*); a folder's keeps *New record set*.
123. **Record editor ⋮ menu:** *Save now*, *Move…*, *Copy link* ("Link copied."), *Used by…*, then *Delete…* (the sample's *Duplicate* is gone). *Delete…* says when pages or
    templates use the record: "It is used by 2 pages or templates. Delete it anyway? …".
124. **Checks and Used by drawer.** A **Checks** button with a count badge (red when any is an error, otherwise yellow) sits before *History* in the header. It opens the
    right-hand drawer "Checks and usage" with two tabs: **Checks** (errors, warnings and notes with the field they are about, most severe first, an error outlined; empty
    state "No problems found") and **Used by** (badge, name, path; empty state "Not used yet"). *Used by…* in the menu opens the second tab. The drawer is non-modal; the
    record's versions stay in *History*. In the sample the findings come from the dataset's rules (a product needs a price, "Only 2 bags left" below 5), so editing the
    price or stock changes the count.
125. **Deleted record.** A banner "This record is deleted — Restore it to edit it again." over the form, a primary **Restore** button in the header (toast "Record restored"),
    the form shown dimmed and not editable, and *Save now*, *Move…* and *Delete…* disabled in the menu.
126. **States without a record**, each a centred empty state under a plain "Record" header with one way out: **Record not found** ("It may have been deleted, or the link is
    wrong." — *Back to content*), **Not there yet** (no such revision — "This record did not exist at that revision." — *Back to now*) and **Could not load the record**
    ("Try again in a moment." — *Try again*).
127. **Not in this round (left as the app has them, unchanged in the sample):** the loading skeleton, time travel on the set and record, the deleted *record set* state, the
    record set's *Delete…* confirmation, release dialogs, and the filter's server-side validation messages (in the app every edit is checked by the server and its errors are
    listed under the panel; the sample has no server).

## Review round 12 (2026-10-03): pages and media — what M35.18 and M35.19 built beyond the signed-off sample (signed off 2026-10-04)

Added to the sample so the user can rule on what the apps do that rounds 8 and 9 did not show (`/styleguide/sample`). **Not signed off yet.** Nothing in the apps changes
for this round; items 111–122 and 128–133 are new in the sample, 123–127 and 134–135 are differences where the app is *not* like the sample and the user decides which one wins. Decisions are
numbered after the highest one at the time of writing (110); renumber if another round landed meanwhile.

Review links (all combine with the usual `view`, `dev`, `theme`, `density`; they are read once and not written back):

| Param | What it shows |
|---|---|
| `view=folder&fstate=loading` / `error` / `empty` | the folder table: skeleton / error with Retry (Retry returns to normal) / empty folder with its hint |
| `view=folder&access=archived`, `view=editor&access=archived`, `view=editor&travel=88` | read-only: archived project (no time-travel banner) or a past revision |
| `view=folder&pdialog=move` / `view=folder&pdialog=folder-move` | the Move dialog for the two selected pages / for the News folder (also from the bulk bar, the folder ⋮ and the tree's *Move to…*) |
| `view=editor&pdialog=delete` | the page delete dialog (the page is online, so it offers the redirect) |
| `view=editor&conflict=fields` / `conflict=whole` | the revision conflict drawer with a choice per field / with only the two whole-page answers |
| `view=editor&issues=1` plus `istatus=checking` / `unavailable` / `published` | the Issues drawer's status line: being checked / unavailable with *Check again* / the preview-shows-published note |
| `view=folder&psettings=folder` | Folder settings with its new *Addresses* section |
| `empty=1&etemplates=1` (add `dev=0`) | the empty project when page templates exist: *Create a page* for everyone |
| `area=media&dialog=rename-folder` (and `dialog=rename`) | the Rename dialog of a folder (of a file), with the UID section in developer mode |
| `area=media&asset=a-hero-texture&mtab=usedby` (add `&urls=error`) | the Used by tab with its URLs panel / with the registry unavailable |
| `area=media&asset=a-hero-texture&dialog=delete`, `area=media&selected=2&dialog=move` | the delete confirmation naming where the file is used / the Move dialog offering the top level for files |

Pages — new in the sample:

128. **Folder table states:** a skeleton while the folder loads; an error line ("The contents of this folder could not be loaded.") with **Retry**; an empty folder says
    "This folder is empty" and adds a hint ("Create a page or a folder here, or move items in from another folder.").
129. **Read-only (archived project, past revision):** *New page*, *New folder* and *Release folder…* are disabled, the table offers no bulk actions, the folder's *Rename*,
    *Move…* and *Delete…* and the tree's *New* menu and edit actions are disabled; in the editor the header says "Revision 88 — read-only" or "Archived project — read-only"
    **instead of** the save status, the ⋮ entries that change something are disabled, and the Page / Folder settings drawer says so and blocks the rename.
130. **The root folder's ⋮ menu** has only *Folder settings…* and *Copy link* (the signed-off sample also offered Rename, Move and Delete there; the root has none of them).
131. **Move dialog for pages and folders** (replaces the placeholder target of decision 89): one dialog for the table's bulk *Move…*, a folder's *Move…* in its ⋮ menu and
    *Move to…* in the tree's menu — "Move N items to…", the page folders as a tree with the first node *Pages* (the project root), a folder being moved and what lies inside
    it showing "Inside the folder being moved" and not choosable, **Move here** disabled until a target is chosen (and saying why), then a toast with **Undo**. (Unlike the
    media dialog it does not mark the current folder.)
132. **The tree's own menu and drag:** *Cut*, *Copy*, *Paste* (Ctrl+X / C / V), *Move to…*, drag to move and copy — all with a toast and Undo — plus *New page here* on a folder
    and *Duplicate* on a page (next to *Add to favorites*); a Favorites branch has none of them.
133. **Bulk actions, as built:** *Duplicate* copies the selected **pages** only — a mixed selection says "N copies created; folders are not duplicated.", folders alone are refused
    ("Folders cannot be duplicated — select pages."); *Release…* on a selection with nothing waiting says "Nothing here is waiting to be released." (otherwise the shared release
    dialog); *Delete* on folders says they go "with everything inside them".
134. **Delete page dialog** (the app's is still the old plain dialog with English text): "Delete “name”?"; for a page that is **online** it says the page stays online until the
    deletion is released and offers **Redirect the old address to another page** (a page picker; *Delete* waits for the target and says why); an Undo toast follows.
135. **Revision conflict drawer** (the app's is still the old plain look): a drawer "This page changed" that says who saved a newer revision, when, and which revision yours was;
    per field both changed it shows *Yours* and *Current* side by side with **Keep mine / Take theirs**, plus **Keep all mine**, **Take all theirs** and **Apply changes**
    (disabled until every field has a choice, and saying so); when the server named no fields only **Keep mine** / **Take theirs** and the list of changed fields.
136. **Editor header extras:** next to the star, in the editing language when it has untranslated fields: "English: 2 of 6 fields not translated" (never for the default language).
137. **Issues drawer status:** under the title a status line — "Checked at 12:04", "Checking…", or "Checks unavailable — the draft could not be checked right now. Editing is not
    affected." with **Check again** (no list while it is unavailable); a note when the preview shows the published page and the checks cover the draft; and, under the list, "Not fully
    checked on a draft, a build checks them: SF-CHK-0301, SF-CHK-0302."
138. **Folder settings: Addresses.** A section listing the folder's URLs per area, channel and language (build and preview), with **Override** and **Set URL** in developer mode only.
139. **Empty project with page templates:** the empty state says a page needs a template and offers **Create a page** (primary, everyone) beside *Create a folder*; without templates
    it stays as signed off (round 8, decision 87).

Pages — the app differs from the sample; the user rules (nothing changed in the sample):

140. **Start page:** the app has **no start-page mark, picker or field** (the pages folders have none in the backend). The sample still shows the *Start page* badge in the table and the
    *Start page* section in Folder settings. Keep it as the target (needs backend work) or take it out of the sample?
141. **Folder rows and folder navigation:** the app shows folders with the template column "Folder" and **no modified / by** ("—"), and Folder settings has **no navigation settings**;
    the sample shows both. Same question: target or drop.
142. **Entries the app does not have:** the page ⋮ has no *Move…* and no F2 on the page; the page header has no *History* button (the top bar's History is the way); the folder ⋮ has no
    favorite entry (the ☆ in the table row does it). The sample has all three. Keep or drop?
143. **Section palette tiles:** the app has no template description, maximum or thumbnail data in its API — a tile shows the template's **UID** as its second line, never "Maximum of N
    reached", and the categories are the template folders (shown only when there are more than two). The sample shows description, maximum and thumbnail slot. Keep as the target or drop?
144. **Duplicate and delete of folders:** the table's *Duplicate* skips folders (item 133); the tree's *Duplicate* exists for pages only. The user may want folder duplication later — a
    note, no sample change.

Media — new in the sample:

145. **Rename dialog with the UID (decision 107, now shown) and for folders:** in developer mode a *UID* section under the name — the UID with **Change UID…**, a warning that links written
    with it break, **Change UID** applying **on its own** (not with *Apply*) with an Undo toast. Folders get the same dialog (*Folder name*, required, free among the sibling folders, no
    extension rule), from *Rename…* in the tree's menu and *Rename folder…* in the page header's ⋮ (which no longer shows F2); F2 in the tree stays the in-place edit.
146. **Copyright:** the Details tab keeps a **Copyright** field under the caption (the app has it; the signed-off sample had none).
147. **Move dialog offers the top level for files** too (files can live at the library root), not only for folders.
148. **Delete names the usages:** deleting a file that is used lists where (page or record, and field) in the confirmation, besides "N places will break".
149. **Completion names in the project's real syntax**, replacing the wording of decision 102: global values `CMS_GLOBAL.brand.roastColor` (not `#global.…`), media `media:hero_texture`,
    pages by UID `page:shop` (not `page:/shop`). `#global.…` still matches. The unfinished example of `complete=1` is `$CMS_VALUE(CMS_GLOBAL.br`.
150. **Used by: URLs.** Under the usages, the file's registered URLs (build and preview) with **Override** / **Set URL** in developer mode only; when the registry cannot be read a quiet note
    "The URLs of this item are not available yet." with **Retry** (no error toast).

Media — the app differs from the sample; the user rules (nothing changed in the sample):

151. **Less data than the sample shows:** the Variants tab has name, width and format only (no height or size); *uploaded by / when* come from the history; Processing's "last attempt" is
    the answer of the switch while open, else a check of the saved text; the PDF preview is an icon with the name; list rows cannot be dragged (cards can); alt text is **not required**
    to save; the menu shows `Del` for Delete. Keep the sample as the target or bring it down to the app?
152. **Tab bar of a text file:** at the drawer's default width (420 px below 1280, else 520) Processing, Rendered and Used by fall into "More". A wider default or another tab order for text
    media — a design question.

## Review round 13 (2026-10-04): templates — what M35.21 needs beyond the signed-off sample (signed off 2026-10-04)

Added to the sample for M35.21 (`/styleguide/sample?area=templates&…`). **Signed off 2026-10-04** (user: approved as shown; palette, locale rule and table data decided below).
Screenshots: `round13-shots/` (1440 px, headless Chrome; 20 states). Decisions continue after 152.

Review links (they combine with the usual `dev`, `theme`, `density`; read once, not written back):

| Param | What it shows |
|---|---|
| `area=templates` (click *Page templates* in the tree) | the folder table; at the root it lists the three folders |
| `area=templates&fstate=loading` / `error` / `empty` | the folder table: skeleton / error with Retry / empty folder |
| `area=templates&tdialog=new` / `newpage` | the New template dialog with nothing chosen / opened from *New ▸ Page template* |
| `area=templates&view=template&template=article&tdialog=usedby` / `rename` / `move` / `delete` | the Used by drawer / Rename / Move / Delete confirmation for the open template |
| `…&view=template&template=article&tstate=loading` / `error` / `saveerror` / `discard` | skeleton / load error with Retry / refused-save banner / Save asks before discarding translations |
| `…&view=template&template=article&access=archived` (or `travel=88`) | read-only template |

153. **Folder view of Templates** (header *New ▸ kind* menu, ⋮ with Rename… / Move… / Delete; the top level has no ⋮): `sf-data-table` with **Name** (icon of the kind, UID in developer
    mode), **Kind**, **Channels** (a chip per channel), **Used by** (the count, a button that opens the Used by drawer; folders "—"), **Modified** (avatar + relative time; folders "—").
    *Kind* filter chip group ("Kind: Page template"), multi-select with bulk **Move…** and **Delete**, loading / error / empty states like the other folder tables.
154. **Used by for templates and datasets:** the existing right-hand drawer ("Used by — Article", non-modal) listing the pages, templates (those that extend it) and — for a dataset —
    record sets that use it, each with a type badge and where; "Not used yet" when empty. From the template header's ⋮, the tree's menu and the table's count.
155. **New template dialog:** the **kind is chosen explicitly** — Page template / Section template / Dataset as a radio group with a line each — and never inferred from the tree selection.
    From a *New ▸ kind* entry the kind is what the person picked; from the header's *New* button nothing is chosen and **Create** says "Choose a kind first." Fields: **Name**, **UID**
    (derived from the name until edited), and for page and section templates an optional **Based on** (an existing item of the same kind; **decided 2026-10-04: it copies that item's contents** — fields, rules, channel templates — into the new one, no backend field, the two stay independent). A note: "The kind can’t be changed after it is
    created." Where it is created is stated ("Created in Page templates."). A folder is made inline in the tree.
156. **Delete (template, dataset, folder; one or many):** a confirmation that **names what uses them** ("In use by 3 pages. They keep their content but may break on the next build."),
    says a folder goes with everything inside, lists the items with "used by N things", then a toast with **Undo**. From the header ⋮, the tree (menu, `Del`, inline) and the table.
157. **Tree menu and Move:** a template's menu is *Duplicate*, *Rename…*, *Move to…*, *Used by*, *Add to favorites*, *Delete*; a folder's is *New ▸ (Page template, Section template,
    Dataset, Folder)*, *Rename…*, *Move to…*, *Add to favorites*, *Delete*. **Rename…** is the Content rename dialog (name; developer-mode UID with **Change UID** on its own and
    Undo). **Move to…** is the folder picker of the Content move dialog with the top level "Templates", the current location and a moved folder's inside not choosable, then a
    toast with Undo. **Duplicate** makes a copy next to the original with an Undo toast. (No cut / copy / paste in this tree.)
158. **Definition fields in Settings:** **Display name**, **Category**, and for page templates **Abstract** (a layout other templates extend), for section templates **Deprecated**
    (no longer offered in the section palette). Switching *Abstract* on while pages use the template is refused inline, naming the pages ("3 pages use this template, so it can’t be
    abstract. Move them to another template first: …").
159. **Channels in Settings:** next to each channel's switch a ✕ **removes** it ("Removed when you save: rss — Undo"); **Add channel** is a menu of the project's channels the template
    has no source for. The channel tabs follow.
160. **Descendants:** a template that others extend shows an info banner "2 templates extend this one. They are checked again when you save." with *Used by*.
161. **Save outcomes:** *refused save* (`tstate=saveerror`) — a danger banner "Not saved: the template has 1 compile error…"; *discarding translations* (`tstate=discard`) — Save first asks
    "This change discards translations" with **Keep the translations** / **Discard and save**.
162. **States of the template view:** loading (skeleton), load error with Retry, and read-only (archived project: "Archived project — read-only"; a past revision: "Revision N — read-only")
    — nothing can be edited, saved, renamed, moved or deleted.
163. **The `{locale}` warning (app differs from the sample):** the sample warns on the output path of **every** page template that lacks `{locale}` (a client check). The app shows the
    **server's** warning (SF-GEN-0112, per channel), which applies only in a multi-language project (M35.1 item 10). **Decided 2026-10-04:** both — a client check while typing, only when the project has more than one language, and the server warning stays the authority.
164. **Data the folder table needs that the API lacks (backend work or fewer columns):** the template summary has **no channels, used-by count or modified** field, and there is no batch usage
    count (M35.20 added `changedAt` for record sets the same way). **Decided 2026-10-04:** add `channels`, `usedByCount` and `changedAt` to the template and dataset summaries (backend, as M35.20 did for record sets).
165. **Selection in the URL:** the app keeps the open template in the store and consumes `?asset=` / `?folder=`; M35.21 moves it to `/templates/:uuid` (folders `?folder=`), so a switch
    goes through the unsaved guard and the open item is recorded as a recent. No sample change.
166. **Code highlighting palette (decision 18, decided 2026-10-04):** *Current* stays the default and *Refined* stays selectable, **per user in the account preferences** (next to Theme and Density); the switch leaves the template header.
167. **Dataset editing:** the sample's dataset view is read-only (overview, schema, rules, record templates); **Decided 2026-10-04: the dataset editor is redone** on the sample's tabs (overview with fields table and Used by, schema and rules as CDL code panels, record template per channel as OCTL panels) with the same editing behaviour as the app. Its ⋮ has the
    same Rename… / Duplicate / Used by / Delete as the other items.

## Review round 14 (2026-10-04): navigation — Visible in menu and the entry page (signed off 2026-10-04 (user instruction))

Added to the sample for the M35.22 follow-up (`/styleguide/sample?area=navigation&nav=…`). **Signed off 2026-10-04 (user instruction)** — the user decided both features
and the app was built to match; decisions continue after 167.

| Param | What it shows |
|---|---|
| `area=navigation&nav=n-coffee` | a folder: the *Entry page* line with **Change…**, the table with **Visible in menu**, bulk *Show in menu* / *Hide from menu* once rows are selected |
| `area=navigation&nav=n-root` (or click the tree title *Navigation*) | the fixed "All navigation" wrapper: its entry page and the top level; ⋮ has only *Entry page…* |
| `area=navigation&nav=n-imprint` | a hidden item: muted in the tree with its *Hidden from menu* marker, the switch off |

168. **Visible in menu (end to end):** every menu item and menu folder has the flag, **on unless it says otherwise** (everything stored before is visible). An entry that is off is **left out of
    the generated menus** (`$CMS_NAVIGATION`, `$CMS_FOR … nav:`, the default HTML) **together with everything below it**; it stays in the Navigation tree and table, its page still exists and builds, and
    entry-page, breadcrumb and first-page resolution ignore the flag. UI: a **Visible in menu** column (sortable; *In menu* / *Hidden from menu* with an eye icon), a **Visible in menu** switch in the menu
    item (saved with Save / Ctrl+S like label and target; the header shows the saved state), **Hide from menu / Show in menu** in a folder's ⋮ menu, the tree's context menu and as **bulk actions** on the
    selected rows — one revision per entry, one Undo toast for the group. The sample's wording changed from *In menu* / *Show in menu* to **Visible in menu** (column and switch) to match.
169. **Entry page (navigation):** every menu folder **including the "All navigation" wrapper** has an *Entry page* — the direct child (menu item or sub-folder) its link in the menu opens; label *Entry page*
    here, *Start page* for pages. The folder view's header carries a line **Entry page: *Company* → Our story** (or **None — grouping only**) with **Change…**; *Entry page…* is also in the folder's ⋮ menu and
    the tree's context menu. It opens a right-hand **drawer** (non-modal `sf-drawer`) with a radio list — *None — grouping only* and every direct child with where it leads — and **Apply** (one revision, Undo toast).
    A page is chosen through its menu item (the server accepts only a direct child). Read-only for viewers, time travel and archived projects. This replaces the inline select of the first sample.
170. **Reaching the wrapper:** the tree title (*Navigation*) is a button that opens "All navigation" as a folder view (the empty state offers the same); it has no rename, move, hide, delete or favorite.
171. **Hidden marker in the tree:** a hidden entry's name is **muted** and carries the neutral eye-off badge *Hidden from menu* (after any release status); it keeps its place in the menu order and in the filter.

## Review round 15 (2026-10-07): menus, bulk bars, media grid and page URLs (signed off 2026-10-07)

Sample catch-up for M35.22 follow-ups 1-4 (the app already implements them). **Announce only:** menus have the app's entries, order and enabled/disabled states; actions toast (with Undo where the app has it).
Open `/styleguide/sample?area=pages|content|navigation|media` and right-click rows, empty space and selections. `area=media&readonly=1` shows the read-only menus.

172. **Row menus = tree menus (pages, content, navigation, media):** a right click on a list row (also Shift+F10 / menu key) opens the same entries as the tree, in the same order: New..., Rename... (a dialog), Cut, Copy, Paste, Move to..., favorite, Duplicate, Release, Delete. Copy only for pages, navigation items, record sets and media files (not folders); Duplicate only for pages, records and media files; Paste is disabled when the clipboard is empty or the target invalid; on a page row it pastes next to it, on a folder row into it. Read-only hides editing entries and keeps favorite and Release.
173. **Release:** in every menu and bar; on a folder it releases everything inside. With nothing pending it stays enabled and shows the info toast "Nothing here is waiting to be released."
174. **Empty-space menus:** pages and content: New page / New folder / New record set; navigation: New menu item (table) and New menu item + New folder (tree); media: Upload, New folder, Paste. A left click on empty tree space opens the root, a right click opens this menu (not in templates); in tables a left click clears the selection.
175. **Multi-selection:** the bulk bar and the right-click menu on several rows show the same actions (pages: Move, Release, Duplicate if a page is selected, Delete; content adds Cut/Copy; navigation: Move, Copy, Release, Show/Hide, Delete; media: counted Move, Cut, Copy, Duplicate, Download, Release, Delete). The pages, content and media trees are multiselect like the app; the navigation tree stays single-select as in the app.
176. **Record grid:** row menu = bulk actions (Release, Move, Duplicate, Delete) acting on the row or its selection; empty space: New record.
177. **Media grid and list:** folders first (accent-coloured folder icon, menu, F2, right click), then files. Explorer behaviour: click, Ctrl, Shift, double click opens, marquee (Ctrl keeps the selection), click on empty space clears, right click selects an unselected card first, arrows / Home / End / Space / Enter / Ctrl+A / F2 / Delete / Shift+F10 / Escape. One rename (the tree's inline one; no second Rename... entry); Upload in the folder menus; the list lost its Actions column and uses the table's row and empty menus. Navigation folder icons are accent-coloured too.
178. **Page URLs from the registry:** the Pages URL column (still developer mode only) and the page settings address show the registered URL plainly; a computed one is muted with the title "Not assigned yet". Two sample pages (never-released drafts) show it.
179. **Build status / banner:** icon, spinner and text vertically centred (sample top bar).
180. **Known gaps of the sample:** Rename... / Move to... in navigation show a "Not part of the sample" notice (no dialogs); folder delete, favorites in navigation and Paste after Copy are announce-only; the keyboard sheet does not list the new media keys.

## Review round 16 (2026-10-07): release dialog for a multi-item selection (pending sign-off)

Follow-up of M35.23: the app's release dialog now looks like the sample's. Open `/styleguide/sample?area=changes&sel=16&release=1`.

181. **Items without a language in the release dialog:** items that are not language-specific (media, globals, navigation links: release key `""`) appear as **one** extra checkbox below the language checkboxes, *Not language-specific (3 items)*, ticked by default and toggling all of them; *All changed languages* governs the languages only. A selection of such items alone shows the heading *Items* with that one checkbox. Pending sign-off.

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
