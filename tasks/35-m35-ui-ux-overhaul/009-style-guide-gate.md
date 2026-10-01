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

## Notes / hazards

- Sign-off: **signed off by the user on 2026-10-01** — gallery https://claude.ai/artifact/33yY26sd6H17UTP9sPPJid
  (version 4: 198 headless-Chrome screenshots of 45 screens) plus the live pages `/styleguide` and `/styleguide/sample`.
  Changes requested during review (all applied before sign-off): decisions 7–34; editor forms full width (33); the
  release actions' divider (34); catalog fields framed like sections; the outline jump no longer shifts the frame
  (`.sf-sr-only` pinned to its containing block); 12 review findings in the design-system code fixed.
- Open after sign-off (not decided at the gate, current behaviour stays until decided):
  - **Code highlighting palette** (decision 18): Current vs Refined was not picked. The current M35.5 palette stays the
    default; Refined stays available via `data-code-palette="refined"`. Decide before M35.21 (templates IDE).
  - **Drawers over the top bar:** `sf-drawer` covers the dark top bar (seen on the media detail). Decide before M35.19
    whether drawers start below the top bar.
