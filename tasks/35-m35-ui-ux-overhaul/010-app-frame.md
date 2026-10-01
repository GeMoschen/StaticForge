---
id: M35.10
status: done
depends: [M35.2, M35.4, M35.9]
epic: m35-ui-ux-overhaul
feature: frame
area: frontend
---

# M35.10 — App frame: top bar, rail, developer mode, titles

## Context

`app.component.*`, `features/dashboard/project-shell.component.*`, `nav-rail.component.*`,
`features/account/user-menu.component.*`, `features/admin/admin-shell`, `features/account/account.component`,
`core/project/*` (effective permissions), `sf-archived-banner`, `sf-time-travel-banner`. User decisions 6, 7, 19.

## Goals

- **Top bar**, one for every authenticated route (project, admin, account, dashboard), from left to right:
  - Product mark, which links to `/`.
  - **Project switcher**: menu button with search, favorites, recents, all projects, and "All projects" linking to `/`.
  - **Breadcrumb**: section › folder path › item. Each segment is a link. Long paths collapse the middle into "…",
    which opens a menu.
  - **Search** field (opens the palette, `Ctrl+K`).
  - Editing-language select, shown only when the project has more than one language. It no longer takes a layout strip
    of its own.
  - **Build status** (last run state, with a spinner while running) plus *Build now*, shown by permission.
  - **History** (M35.12).
  - Theme menu: light/dark/system, density, and the developer mode switch (only for users with developer rights).
  - `?` shortcut sheet (M35.14).
  - User menu: account, administration (instance admins), sign out.
- **Left rail**, labelled groups, collapsible (52 px / 232 px — the `--sf-rail-width-*` tokens, decided in M35.9 — stored in preferences), with a tooltip for each item
  when collapsed:
  - **Home** (project home, M35.28).
  - **Content**: Pages, Media, Content, Navigation, Globals.
  - **Publish**: Changes (badge), Publishing, Schedules.
  - **Develop**: Templates (hidden in editor view).
  - Footer: Settings.
- **Permission-driven visibility:** items, actions and tabs render only when the effective permissions allow them.
  Remove "disabled because not allowed" patterns where hiding is clearer; keep a disabled state with a reason tooltip
  only for a temporary state (for example "nothing to release").
- **Developer mode:** `DeveloperModeService`, backed by preferences and only available with developer rights.
  - Off hides the Develop group, schema tabs, CDL hints, UIDs and paths (decision 19).
  - A single `*sfDevOnly` structural directive (or an `@if` on the service) so screens don't reimplement the check.
- **Route titles:** a `TitleStrategy` gives "Item · Section · Project — StaticForge"; every route gets a `title`
  resolver.
- **Admin and Account** move into the frame: same top bar, admin sections in the rail (Users, Projects, Jobs, Audit).
  Remove the centered layout and the separate tab style.
- Archived and time-travel banners live below the top bar in one banner region.
- The skip link targets the main region. Landmarks: `header`, `nav` (rail), `main`.

## Acceptance criteria

- [x] Every screen reachable before is reachable from the frame. From inside a project you can reach the project list
      and switch project.
- [x] Editor view (developer mode off, or an `EDITOR` account) shows no developer item or identifier in the frame.
- [x] Vitest: breadcrumb building, switcher, visibility matrix per role, titles.
- [x] Screenshots of the frame in each state reviewed (see README definition of done).
- [x] `npx vitest run` and `npx ng build` green (229 files, 1,930 tests; build and lint green).

## Out of scope

- Moving Generation and splitting Settings (M35.11), history (M35.12), palette actions (M35.14), recents content
  (M35.15).

## Notes / hazards

- Once the new frame exists, journeys will break. That is expected until M35.31; don't fix them here.

## Review (2026-10-01)

- **Frame:** `AppFrameComponent` is the parent route of dashboard, account, admin and project (auth guards moved onto it;
  login, set-password and the style guide stay outside). Header (top bar) / banner region / `nav` rail / `main#sf-main-content`;
  skip link targets `main`. The rail is left out on the project list and the account page.
- **Top bar** follows the signed-off sample: mark, project switcher (search, favorites, recents, all projects, "All
  projects" → `/`), breadcrumb (collapses the middle into "…"), search (opens the palette), editing language (codes, only
  with more than one language), build status (spinner while running, recent builds popover) + *Build now* (by
  `canIncrementalBuild`, disabled with a reason while a build runs), History, appearance (theme, density, developer mode —
  only with developer rights), `?` sheet, user menu. Old `sf-nav-rail` and `sf-user-menu` are deleted.
- **Rail:** `railGroups()` (pure) — Home, Content, Publish (Changes badge), Develop (developer mode only), Settings in the
  footer; administration shows Users / Projects / Jobs / Audit. Collapsed state is the `railCollapsed` preference
  (52 / 232 px tokens), tooltips and accessible names when collapsed.
- **Developer mode:** `DeveloperModeService` (available = developer/admin of the *open project*, or anywhere outside one;
  on until switched off, so `PreferencesService.developerMode()` is now `boolean | undefined`) and `*sfDevOnly`.
- **Titles:** `AppTitleStrategy` collects route titles, `DocumentTitleService` composes "Item · Section · Project —
  StaticForge". `useFrameItem()` lets a screen report its open item; the page editor does (name only).
- **Preferences:** new `favoriteProjects` and `recentProjects` (cap 5). The legacy `sf-nav-rail-expanded` key has no
  reader any more; `MIGRATION_REMOVES_LOCAL_KEYS` stays `false` (the page editor split, record grid, issues and preview
  still read `localStorage`).
- **Bugs the specs caught:** the title strategy and the frame context formed a DI cycle through the router (the strategy
  now looks the store up on use); the build-status refresh coalescing wrote a stale answer over the follow-up read.
- **Checked in a browser** (headless Chrome against a seeded dev backend; light/dark, compact/comfortable, rail
  collapsed, developer mode off, 1440 and 1024; instance admin and an editor account): titles, breadcrumb, switcher,
  appearance and user menus, `?` sheet, admin and account inside the frame, no console errors, no page-level horizontal
  scroll at 1024.
- **Left for later tasks (by design):**
  - *Home* links to the project root, which still redirects to Pages (the project home is M35.28).
  - *Publishing* opens Settings → Generation (M35.11); *History* opens Settings → Revisions (M35.12). The revision spine
    stays beside the screen until M35.12 removes it.
  - The breadcrumb for items shows area › item; folder segments need folder URLs (M35.18, and the other screens report
    their items as they migrate). Only the page editor reports an item so far.
  - The `?` sheet lists the two shortcuts that exist; M35.14 fills it from a registry.
  - Hiding controls inside screens by permission (instead of disabling them) belongs to the screen tasks.
  - At 1024 px the page editor's preview is still clipped (screen layout, M35.18 / M35.27).
  - Dashboard and account keep their own content layout (M35.16, M35.28); the account page lost its back link and user
    menu, admin lost its tabs and centering.
  - Drawers still cover the top bar (open question from M35.9, decide before M35.19).
