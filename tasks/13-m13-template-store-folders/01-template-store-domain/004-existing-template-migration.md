---
id: M13.1.4
status: todo
depends: [M13.1.2, M13.1.3]
epic: m13-template-store-folders
feature: template-store-domain
area: backend
---

# M13.1.4 — Reparent existing templates into the fixed folders

## Context

Every `PAGE_TEMPLATE`/`SECTION_TEMPLATE` created before this milestone was
created with `parentFolderUuid = null`, which `AssetServiceImpl.create`
resolves to the hidden global project root (`resolveParent(null, ...)` →
`ensureRootFolder`) — so today's "flat" templates aren't folder-less in the
data model, they're literally parented at the hidden root, same as a
folder-less Page or Media asset would be. Once `M13.1.2`/`M13.1.3` land,
new templates go under the correct fixed folder automatically, but every
pre-existing template is still sitting at the hidden root and needs a
one-time reparent.

## Goals

- A one-time, idempotent repair path — run once per project (on first
  access is fine, e.g. lazily alongside `ensureTemplateFolders`, or as an
  explicit startup/admin step; pick whichever fits this codebase's existing
  migration conventions, e.g. compare against how `M9`'s server-wide uuid
  migration or `M7`'s Liquibase changelogs were run, and follow that
  precedent rather than inventing a new one) that: for every project, for
  every current `PAGE_TEMPLATE`/`SECTION_TEMPLATE` whose `folderId` is the
  hidden root (or otherwise not already under a `TEMPLATES`-scope folder),
  moves it to that project's matching fixed folder by kind.
- The move must go through the same revisioned path
  `FolderServiceImpl`/`AssetServiceImpl` already use (close current version,
  insert new version with updated `folderId`/`folderPath`) — no direct SQL
  UPDATE that bypasses revisioning, since every other structural change in
  this codebase is revision-aware (`@RevisionAware`).
- Safe to run against a project that has already been migrated (no-op) and
  against a project with zero templates (no-op).

## Acceptance criteria

- [ ] After migration, every `PAGE_TEMPLATE` in every existing project is
      under (directly or nested beneath) that project's "Page Templates"
      folder; every `SECTION_TEMPLATE` under "Section Templates".
- [ ] Each reparented template's revision history is intact — its prior
      versions are still queryable, and the reparent itself appears as a
      normal `MOVE` revision (matching `FolderServiceImpl.move`'s existing
      `AssetChange.create(..., "MOVE", ...)` summary pattern).
- [ ] Running the migration twice against the same project is a no-op the
      second time.
- [ ] A template that was already manually placed under a `TEMPLATES`
      folder (shouldn't exist pre-migration, but guard anyway) is left
      alone, not double-moved.

## Out of scope

- Any change to template content/payload — this is purely a folder
  reparent.

## Notes / hazards

- This is the one task in the feature that touches real, already-live data
  across every existing project — test it against a fixture with templates
  that have prior revisions/channel edits and confirm nothing about their
  content or revision timeline changes, only `folderId`/`folderPath`.
