# M13 — Template store folders

**Spec:** Extends §10.2 (folder model) and §12/§13 (templates) of
`cms-specification.md`. Not part of the original §27 roadmap — inserted the
same way `M8`–`M12` were, giving the template store (`PAGE_TEMPLATE` +
`SECTION_TEMPLATE`) the same folder hierarchy the Pages, Media, and
Navigation stores already have (`FolderScope.PAGES`/`MEDIA`/`NAVIGATION`,
`FolderService`, `PathService`).

## Goal

Today `TemplateServiceImpl.create` always creates a template with
`parentFolderUuid = null` (`FolderScope.requiredFor(PAGE_TEMPLATE)` and
`requiredFor(SECTION_TEMPLATE)` both return `null` — confirmed in
`AssetServiceImpl.validateFolderScope`, which is a no-op for template
types), so every template in every project is a flat list under the hidden
project root with no folder concept at all (`templates.component.ts` renders
a flat, kind-toggled list — no tree). `M11.1.2` explicitly called this out
and left it out of scope: *"templates have no store/tree concept the way
Pages/Media/Navigation do... if a 'select all templates' convenience is
wanted later, it would need a different mechanism."* This milestone is that
follow-up: give the template store a real folder tree, matching the
Pages/Media/Navigation pattern everywhere it already exists (backend model,
selective export/import, UI).

### Key decision — the fixed two-branch skeleton

Unlike Pages/Media/Navigation (arbitrary top-level folders, freely
created/renamed/deleted), the template store's top level is **fixed**:

- One new `FolderScope.TEMPLATES`.
- Its top level is closed: `FolderService.tree(projectId, TEMPLATES, ...)`
  always returns **exactly two** depth-0 nodes — "Page Templates" and
  "Section Templates" — auto-provisioned once per project (mirroring
  `ProjectServiceImpl.create`'s existing `folderService.create(null,
  "Navigation", FolderScope.NAVIGATION, ...)` call for the Navigation root,
  and `AssetServiceImpl.ensureRootFolder`'s lazy-create pattern for the
  hidden global project root). No third folder can ever be created directly
  under the `TEMPLATES` scope's top level — `FolderService.create` rejects a
  `null`/root parent for this scope outright.
- Those two folders are **protected**: a new `protected` folder-payload flag
  (new primitive — no existing folder in any store has this today) that
  `FolderServiceImpl.update`/`move`/`delete` reject on. They can never be
  renamed, moved, or deleted, but folders and templates *can* be freely
  created, renamed, moved, and deleted **inside** them, arbitrarily nested,
  exactly like every other store.
- Each of the two fixed folders carries which template kind it holds
  (`PAGE_TEMPLATE` / `SECTION_TEMPLATE`); every descendant folder inherits
  that kind the same way `scope` already inherits parent→child in
  `FolderServiceImpl.create`, and it gates which asset type can be created
  in that subtree — a `PAGE_TEMPLATE` can never land under "Section
  Templates" or vice versa.
- **UID uniqueness is unaffected.** `AssetServiceImpl` derives/checks a
  template's uid via `findByProjectIdAndAssetTypeAndUid(projectId,
  assetType, uid)` — scoped by `(project, AssetType)`, never by folder. That
  does not change: a page template and a section template may still share a
  uid, and two page templates in different folders still collide on uid the
  same as two page templates at the same "level" would today. Folders here
  are pure organization, not a uid-scoping boundary — explicitly confirmed
  with the user, called out again in each task below so no task
  reintroduces folder-scoped uid uniqueness by accident.

## Exit criteria (epic is done when)

- [ ] Every project (new and pre-existing) has exactly one "Page Templates"
      and one "Section Templates" folder at the top of the `TEMPLATES`
      scope, both protected from rename/move/delete, both always present.
- [ ] A `PAGE_TEMPLATE`/`SECTION_TEMPLATE` can be created directly under its
      fixed folder or under any nested subfolder beneath it; folders under
      each fixed root can be created, renamed, moved (within the same
      kind's subtree), and deleted exactly like Pages/Media/Navigation
      folders.
- [ ] Pre-existing templates (today's flat, folder-less rows) are
      reparented under the correct fixed folder by kind, losing no
      revision history.
- [ ] Template uid uniqueness stays scoped to `(project, AssetType)`, not to
      folder — proven by a regression test, not just unchanged code.
- [ ] `ExportSelection`/`ProjectExportImportServiceImpl` reach template
      folders exactly the way they already reach Pages/Media/Navigation
      folders: a picked template folder exports its live subtree, template
      folders participate in `fullStores`, and import re-provisions/reuses
      the two fixed folders by identity rather than duplicating them.
- [ ] `templates.component` shows a folder tree (fixed "Page Templates" /
      "Section Templates" roots, non-editable, with normal folder
      creation/rename/move/delete beneath) instead of today's flat
      kind-toggled list, with template creation, rename, and move all going
      through it.
- [ ] The export/import selection panel (`project-settings-export.component`,
      `M11.3`) offers templates as a fourth tree scope alongside
      Pages/Media/Navigation instead of today's flat searchable list
      (`M11.3.1`).

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [template-store-domain](01-template-store-domain/README.md) | backend | — |
| 2 | [export-import](02-export-import/README.md) | backend | 1 |
| 3 | [template-store-ui](03-template-store-ui/README.md) | frontend | 1 |
| 4 | [verification](04-verification/README.md) | qa | 1, 2, 3 |

Features 2 and 3 both depend only on feature 1's data model landing first;
they touch disjoint code (backend export service vs. Angular components) and
can be built in parallel once feature 1 is done.

## Dependencies

Reuses `FolderScope`/`FolderService`/`FolderServiceImpl`/`PathService`
(`M1`/`M8`), `AssetService.create`/`move` (folder-scope validation already
generic per `AssetServiceImpl.validateFolderScope`), `AssetController`'s
generic `/assets/{uuid}/move` (already dispatches to `FolderService.move`
for folders and `AssetService.move` for non-folder assets — no new move
endpoint needed), `ExportSelection`/`fullStores` (`M10.1`/`M11.1.3`), and the
Pages/Media folder-tree UI patterns (`folder-node.component`,
`media-folder-node.component` — each store owns its own folder-node
component today, there is no shared one; this milestone follows that
existing precedent rather than introducing a new shared abstraction, which
is out of scope here).

## Notes

- `cms-specification.md` §12/§13 describe templates as a flat store. Updating
  the spec to document the folder hierarchy is a follow-up doc change once
  this epic ships — not tracked here, since `tasks/` intentionally holds no
  spec edits.
- The "protected folder" primitive introduced here (feature 1, task 1) is
  deliberately generic (`protected: true` in a folder's payload, enforced by
  `FolderServiceImpl`) rather than template-specific, in case a future store
  needs the same fixed-skeleton pattern — but this milestone's only consumer
  is the two template folders; do not invent other protected folders.
