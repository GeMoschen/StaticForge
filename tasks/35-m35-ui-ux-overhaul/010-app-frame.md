---
id: M35.10
status: todo
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
- **Left rail**, labelled groups, collapsible (64 px / 220 px, stored in preferences), with a tooltip for each item
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

- [ ] Every screen reachable before is reachable from the frame. From inside a project you can reach the project list
      and switch project.
- [ ] Editor view (developer mode off, or an `EDITOR` account) shows no developer item or identifier in the frame.
- [ ] Vitest: breadcrumb building, switcher, visibility matrix per role, titles.
- [ ] Screenshots of the frame in each state reviewed (see README definition of done).
- [ ] `npx vitest run` and `npx ng build` green.

## Out of scope

- Moving Generation and splitting Settings (M35.11), history (M35.12), palette actions (M35.14), recents content
  (M35.15).

## Notes / hazards

- Once the new frame exists, journeys will break. That is expected until M35.31; don't fix them here.
