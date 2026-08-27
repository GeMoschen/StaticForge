# Feature: Template store domain

**Spec:** Extends §10.2 (folder model) with a `TEMPLATES` `FolderScope` and a
new "protected folder" primitive; extends §12/§13 (templates) so
`PAGE_TEMPLATE`/`SECTION_TEMPLATE` become folder-scoped asset types.

## Goal

Give the template store the same `FolderScope`/`FolderService` machinery
Pages, Media, and Navigation already use, with one addition none of them
need: a fixed, protected two-branch top level ("Page Templates" / "Section
Templates") that always exists and can never be renamed, moved, or deleted —
see the milestone README's "Key decision" section for the full design.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-protected-folder-primitive.md](001-protected-folder-primitive.md) | — |
| 2 | [002-template-folder-scope-and-provisioning.md](002-template-folder-scope-and-provisioning.md) | 1 |
| 3 | [003-template-create-move-api.md](003-template-create-move-api.md) | 2 |
| 4 | [004-existing-template-migration.md](004-existing-template-migration.md) | 2, 3 |

## Feature exit criteria

- [ ] `FolderServiceImpl.update`/`move`/`delete` reject any mutation of a
      folder whose payload has `protected: true`, with a clear 422.
- [ ] `FolderScope.TEMPLATES` exists; every project has exactly one "Page
      Templates" and one "Section Templates" folder, both `protected`,
      auto-provisioned for new projects and backfilled for existing ones.
- [ ] `PAGE_TEMPLATE`/`SECTION_TEMPLATE` creation accepts a
      `parentFolderUuid` under the matching fixed folder's subtree (direct
      child or nested), defaulting to the fixed folder itself when omitted;
      a mismatched kind (e.g. a `SECTION_TEMPLATE` under "Page Templates")
      is rejected the same way `AssetServiceImpl.validateFolderScope`
      already rejects a `MEDIA` asset under a `PAGES` folder.
- [ ] Pre-existing templates (today's flat rows, folder-less in practice —
      parented at the hidden project root) are reparented to the correct
      fixed folder by kind, with revision history intact.
- [ ] Template uid uniqueness remains scoped to `(project, AssetType)` only
      — a regression test proves two templates of the same kind in
      different folders still collide on uid, and a page template and a
      section template may still share a uid.

## Dependencies

`FolderScope`/`FolderService`/`FolderServiceImpl`/`PathService`,
`AssetService`/`AssetServiceImpl` (`validateFolderScope`, `move`,
`ensureRootFolder`'s lazy-create pattern), `TemplateServiceImpl`/
`CreateTemplateCommand`, `ProjectServiceImpl.create` (Navigation-root
provisioning precedent), `UidGenerator.deriveUid` /
`findByProjectIdAndAssetTypeAndUid`.
