---
id: M8.2.1
status: todo
depends: [M8.1.2]
epic: m8-navigation-rewrite
feature: url-registry
area: backend
---

# M8.2.1 — URL registry domain model

## Context

Model the registry as a plain cache table, not a revisioned asset — it does not need
diff/restore, and forcing it through the `Asset`/`AssetVersion` revision machinery would
make "assigned once, changes only via explicit reset" harder to reason about than a
dedicated table with its own audit columns.

## Goals

- New entity `UrlRegistryEntry` (Liquibase changelog, next free number after the last
  existing one): `id`, `projectId`, `channelKey` (FK-by-value to `OutputChannel.key`,
  same non-FK convention channels already use elsewhere if any), `pageReferenceUuid`,
  `area` (enum `PREVIEW | GENERATED`), `url` (the assigned string), `assignedAt`,
  `assignedRevision` (the project revision at which this URL was first computed, for
  audit — not used to invalidate), `overridden` (boolean — true once a human edits it
  via `M8.2.4`'s modify endpoint, so automatic reassignment after a reset can be
  distinguished from manual edits in the UI).
- Unique constraint on `(projectId, channelKey, pageReferenceUuid, area)` — exactly one
  live URL per tuple.
- No `validFrom/validTo` interval versioning (unlike `AssetVersion`) — a reset performs
  an in-place delete-then-recompute-on-next-access, not a new revision row. Document
  this deliberate divergence from the revision pattern in Notes.

## Acceptance criteria

- [ ] Liquibase changelog creates the table with the unique constraint above and
      indexes on `(projectId, area)` and `(pageReferenceUuid)` for the settings UI's
      list/filter queries.
- [ ] Repository (`UrlRegistryRepository`) supports find-by-tuple, find-all-by-project
      (paginated, filterable by channel/area), and delete-by-scope (single entry,
      whole channel, whole project) for the reset operation in `M8.2.2`.

## Out of scope

- Assignment/resolution logic (`M8.2.2`), generation/preview wiring (`M8.2.3`).

## Notes / hazards

- Deleting a `PageReference` (in `M8.1`) must cascade-delete its registry entries in
  both areas — add an `ON DELETE CASCADE` or explicit cleanup in
  `NavigationService`'s delete path; a dangling registry row pointing at a deleted
  reference is a silent-bug magnet.
