---
id: M13.1.2
status: todo
depends: [M13.1.1]
epic: m13-template-store-folders
feature: template-store-domain
area: backend
---

# M13.1.2 — `FolderScope.TEMPLATES` + fixed-folder provisioning

## Context

`FolderScope` currently has `PAGES`, `MEDIA`, `NAVIGATION`. This task adds
`TEMPLATES` and provisions its fixed, protected two-branch skeleton — see
the milestone README's "Key decision" section for the shape. Provisioning
must work for both brand-new projects (mirror
`ProjectServiceImpl.create`'s existing Navigation-root call) and every
already-existing project (no project should ever be observed without both
fixed folders).

## Goals

- `FolderScope` gains `TEMPLATES`.
- Folder payload gains a `templateKind` field (`PAGE_TEMPLATE` /
  `SECTION_TEMPLATE`), written on the two fixed folders and inherited
  parent→child by every folder created beneath them — mirror exactly how
  `scope` already inherits in `FolderServiceImpl.create` (`parentScope`
  block): a subfolder's `templateKind` must match its parent's if the
  subfolder doesn't specify one, and a mismatch is rejected the same way a
  cross-`scope` subfolder is today.
- `FolderServiceImpl.create` rejects creating any folder directly at the
  `TEMPLATES` scope's top level (`parentFolderUuid == null`, scope ==
  `TEMPLATES`) — the top level is closed to exactly the two fixed folders,
  forever.
- `ProjectServiceImpl.create` provisions both fixed folders for every new
  project, immediately after the existing Navigation-root call: "Page
  Templates" (`templateKind: PAGE_TEMPLATE`, `protected: true`) and
  "Section Templates" (`templateKind: SECTION_TEMPLATE`, `protected:
  true`), each with a stable, well-known `uid` (e.g. `page-templates` /
  `section-templates` — pick uids that can't collide with a user-chosen
  display name's derived uid; confirm `UidGenerator` never produces these
  for an arbitrary display name, or reserve them explicitly) so export/
  import (`M13.2`) can recognize and re-target them by identity rather than
  duplicating them on import into the same or another project.
- A lazy `ensureTemplateFolders(projectId, ctx)` (mirroring
  `AssetServiceImpl.ensureRootFolder`'s pattern) that creates the two fixed
  folders if missing and is safe to call repeatedly — used by `M13.1.4`'s
  migration path and as a defensive fallback anywhere the template API
  needs to resolve a project's fixed folders.

## Acceptance criteria

- [ ] A newly-created project has both fixed folders immediately, each
      `protected`, each with the correct `templateKind`.
- [ ] `FolderService.tree(projectId, TEMPLATES, depth, ctx)` returns exactly
      these two nodes at depth 0, always, for every project.
- [ ] Creating a folder with `scope=TEMPLATES` and no parent (top-level) is
      rejected with a clear 422.
- [ ] A subfolder under "Page Templates" inherits `templateKind:
      PAGE_TEMPLATE`; attempting to create one there with an explicit
      `templateKind: SECTION_TEMPLATE` is rejected.
- [ ] `ensureTemplateFolders` is idempotent — calling it twice on the same
      project creates the folders once.

## Out of scope

- Reparenting *existing* templates into these folders — `M13.1.4`.
- The template create/move API actually using `templateKind` to validate
  which asset type lands where — `M13.1.3`.

## Notes / hazards

- Don't special-case `TEMPLATES` provisioning as a one-off script — route it
  through the same `FolderService.create`/`AssetService.create` path every
  other folder uses, per `ProjectServiceImpl.create`'s own comment ("no
  special-casing"). The only genuinely new code is the `protected`/
  `templateKind` payload fields and the top-level-creation guard.
- Picking the well-known uids (`page-templates`/`section-templates` or
  similar) is a one-way door once real data exists under them — get this
  right before `M13.1.4` runs against real projects, since export/import
  identity-matching (`M13.2.2`) depends on it.
