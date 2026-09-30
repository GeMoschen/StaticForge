---
id: M35.3
status: done
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

- [x] Backend integration tests: get default, patch merge, size cap (413/422 with an `SF-` code), a user can read only
      their own document, deletion with the user.
- [x] OpenAPI regenerated; UI types match; `docs/api.md` updated.
- [x] Vitest: coalesced patching, a failed patch is retried and never loses keys, the one-time localStorage migration.
- [x] `./gradlew test`, `npx vitest run` and `npx ng build` green.

## Out of scope

- The UI that uses these keys (M35.5, M35.10, M35.15, …).

## Review (2026-09-30)

- Backend: `GET/PUT/PATCH /api/v1/me/preferences` (RFC 7386 merge; `application/json` and `application/merge-patch+json`),
  table `user_preferences` (changeset 032, FK `ON DELETE CASCADE`), 64 KB cap -> 413 `SF-DOM-0133`, bad body or
  `schemaVersion` -> 422 `SF-DOM-0134`. Writes lock the `app_user` row, so concurrent tabs lose no keys. User deletion
  only anonymises the row, so `UserAdministrationService.delete` removes the document explicitly. `UserPreferencesApiTest`
  (10 tests). `./gradlew test`: 989 tests, one failure (`ReleaseApiTest` search with `releaseStatus=CHANGED`, line 307),
  which also fails on a clean HEAD copy, unrelated.
- Client: `core/preferences/` (`PreferencesService`, merge-patch helpers, migration, `providePreferencesSync()` in
  `app.config.ts`). Debounce 500 ms (max 5 s), one request in flight, retry with backoff, 400/413/422 dropped.
  `npx vitest run` 145 files / 965 tests, `npx ng build` green (pre-existing NG8102 warnings only).
- Decisions: the document is unversioned beyond `schemaVersion: 1`; per-project keys live under `projects[projectKey]`.
  The legacy `localStorage` keys are migrated to the server but **not removed** (`MIGRATION_REMOVES_LOCAL_KEYS = false`)
  because theme, rail, page editor, record grid, issues panel, preview and editing locale still read them. Whoever moves
  the last consumer (M35.5, M35.10, M35.15, ...) sets the flag to `true`. `sf-section-collapsed-*` is not migrated.
- Not done: no consumer reads the service yet (out of scope). The generated `operationId`s shifted (`replace` ->
  `replace_1`), noise in `schema.d.ts`.
