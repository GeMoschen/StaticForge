---
id: M35.3
status: todo
depends: []
epic: m35-ui-ux-overhaul
feature: preferences
area: fullstack
---

# M35.3 — User preferences API and client store

## Context

User decision 15. Today preferences live in `localStorage`, scattered across components: rail expanded, theme, split
ratio, section collapse, grid columns, issue scopes, preview view and editing locale.

## Goals

- **Backend.**
  - `GET` / `PUT /api/v1/me/preferences`: one JSON document per user, versioned by a `schemaVersion` field, size-capped
    (~64 KB).
  - `PATCH` with JSON merge semantics, so that concurrent tabs don't overwrite each other's keys.
  - Stored in a new table via a Liquibase changeset. Not part of project revisions or exports.
  - Deleted with the user.
- **Keys**, instance-wide unless marked per project:
  - `theme` (light/dark/system), `density` (compact/comfortable), `developerMode`, `railCollapsed`.
  - `paneSizes` (by pane id), `treeExpansion` (per project and tree).
  - `recents` (per project; capped, e.g. 20), `favorites` (per project).
  - `editingLocale` (per project), `previewView`, `gridColumns` (per record set), `issueScopes`.
- **Client.**
  - A `PreferencesService` with typed signal accessors, optimistic local updates and a debounced `PATCH` (coalesce;
    never drop — see the throttle lesson in `tasks/lessons.md`).
  - Loads after login and falls back to defaults offline.
  - Migrates existing `localStorage` keys once, then removes them.

## Acceptance criteria

- [ ] Backend integration tests: get default, patch merge, size cap (413/422 with an `SF-` code), a user can read only
      their own document, deletion with the user.
- [ ] OpenAPI regenerated; UI types match; `docs/api.md` updated.
- [ ] Vitest: coalesced patching, a failed patch is retried and never loses keys, the one-time localStorage migration.
- [ ] `./gradlew test`, `npx vitest run` and `npx ng build` green.

## Out of scope

- The UI that uses these keys (M35.5, M35.10, M35.15, …).
