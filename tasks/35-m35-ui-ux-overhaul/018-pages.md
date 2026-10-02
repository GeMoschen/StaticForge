---
id: M35.18
status: todo
depends: [M35.11, M35.12, M35.13, M35.14, M35.15, M35.17]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.18 — Pages: tree, folder table, page editor

## Context

`features/pages/*`: `pages-list`, `folder-node`, `page-nav-node`, `folder-detail`, `page-editor` (after M35.2),
section palette, issues panel, release bar, conflict drawer, `page-delete-dialog`, preview split. Screenshots 10–19 and
E1. User decisions 17 and 18. Spec §24.5 #3 (folder table).

## Goals

- **Tree** (`sf-tree`):
  - Folders and pages. Bodies and sections are **not** tree nodes any more; they live in the editor's outline.
  - Filter box in the tree header.
  - One *New* menu (page, folder).
  - Status badges with text alternatives.
  - UIDs only in developer mode.
  - Cut, copy, paste, duplicate, rename (`F2`), delete (confirm and undo), move by drag or keyboard.
- **Folder view** (folder selected, root included):
  - `sf-page-header`: folder name, breadcrumb, actions (New page, New folder, Release folder…, ⋮).
  - `sf-data-table` of children: name, template, status per language, modified (relative, by whom), released, URL.
  - Multi-select bulk move, delete, release, duplicate.
  - The start page is marked.
  - Folder settings (start page, navigation settings) in a side panel or ⋮ → *Folder settings*, not above the title.
- **Empty project:** the empty state explains that a page needs a template and links to Templates (developer) or tells
  editors to ask a developer.
- **Page editor:**
  - `sf-page-header` with breadcrumb, page name (h1), status pills per language, favorite ☆, save status, primary
    *Release…* (primary when there is something to release), *Preview* toggle, *History*, and ⋮ (Schedule, Unpublish,
    Duplicate, Move, Rename, Delete, Copy link).
  - Page meta (display name, UID in developer mode, navigation settings) in a *Page settings* drawer tab instead of the
    title popover.
  - Left outline: page fields, bodies, sections (drag to reorder, `Alt+↑/↓`, add between).
  - Centre: form (M35.17).
  - Right: preview (M35.29) in a `sf-splitter`, collapsible.
- **Section palette:**
  - An `sf-dialog` with a filter, categories, template descriptions and thumbnails when available.
  - Keyboard and `Esc` support.
- **Issues panel:**
  - A single collapsible panel with counts in the header.
  - Grouped by level.
  - Scope chips explained ("Checked when: editing / saving / releasing / building").
  - Rename "Impact as of now" to something plain (for example "Pages affected by this change").
- **Incomplete-page preview:** an explanatory empty state instead of a blank frame.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Bulk actions in the folder table, each with undo where decision 10 applies.
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.

## Notes (M35.9 / M35.10)

- The signed-off sample (`/styleguide/sample`) is the visual reference for the tree, folder table and page editor:
  outline, full-width form (decision 33), a catalog field with a nested catalog, and the preview in an `sf-splitter`.
- Release actions are one group in the page header; a divider and spacing separate them from the page's own ⋮
  (decision 34; shared `sf-release-actions`, M35.23).
- M35.10 only reports the page name to the breadcrumb; folder segments need folder URLs - add them here. At 1024 px the
  preview is still clipped (the splitter and M35.27 fix it).
- The project *Home* rail item still redirects to Pages until M35.28.
