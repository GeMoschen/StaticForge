---
id: M27.6.2
status: done
depends: [M27.6.1, M27.6.5, M27.4.4]
epic: m27-release-and-scheduling
feature: ui
area: frontend
---

# M27.6.2 — Changes view: every unreleased change, diff, multi-select release/discard/schedule

## Context

New lazy feature `features/changes/` (route `p/:projectKey/changes`), `features/dashboard/nav-rail.component.*` (new
entry with count badge from `GET /changes/count`), `features/revisions/revision-diff.component` (reuse the diff
rendering), `M27.6.1` (release dialog, badges), `M27.6.5` (shared schedule dialog), API `GET /changes`, `/changes/{uuid}/diff`, `/releases*`. Epic decisions 6, 9, 11.

## Goals

- **List** (server-paged table): type icon, name + uid, folder path, locale, status badge, changed by/at, released
  at, scheduled indicator. Filters in the URL (lessons: filters as chips, visible chosen values): type, status,
  locale, changed by, folder (picker), text. Sort by changed at (default) / name.
- **Row → diff panel**: the draft-vs-released diff for that locale (field paths, rich text block diff), with "Open in
  editor".
- **Multi-select** (checkbox column + "select all on this page"): **Release…** (the `M27.6.1` dialog with the selected
  items; dependencies proposed across the whole selection), **Discard changes…**, **Schedule release…** (schedule
  dialog, `M27.6.5`). One action = one revision; afterwards the list refreshes and the selection clears.
- **Nav rail** entry "Changes" with the count of `CHANGED + NEW + DELETION_PENDING` for the project (refreshes on
  navigation and after release actions; no polling).
- Read-only mode and roles as in `M27.6.1` (viewers see the list and diffs, no actions).
- Keyboard: row navigation with ↑/↓, space toggles selection, Enter opens diff (§24.6).

## Acceptance criteria

- [x] Vitest: filters map to query params and back; multi-select sends the right items; count badge updates after a
      release.
- [x] Manual check with ~200 changes: paging, filters, diff for localized vs shared change.
- [x] Keyboard-complete selection and release.
- [x] `npm run build` and `npx vitest run` green.

## Out of scope

- Approval workflow; bulk actions across pages of results beyond the current page (select all on page only).

## Notes / hazards

- The diff component from revisions expects revision pairs; add an input for "two payloads" rather than faking revisions.
