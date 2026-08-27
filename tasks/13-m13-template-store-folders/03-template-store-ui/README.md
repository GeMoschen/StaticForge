# Feature: Template store UI

**Spec:** Extends §23 (Angular features) so the Templates screen and the
export/import selection panel present the template store's new folder
hierarchy (`M13.1`) instead of today's flat, kind-toggled list.

## Goal

`templates.component` (`ui/src/app/features/templates/`) currently renders
a flat list of templates with a section/page toggle (`kind` signal) and no
folder awareness at all — `newTemplate()` always creates at the top with no
parent, `TemplatesService`/`ApiClient` have no folder calls for templates.
Bring it up to the same bar as `pages-list.component`/`folder-node.component`
(Pages) and `media-library.component`/`media-folder-node.component`
(Media): a real folder tree, with the two fixed "Page Templates"/"Section
Templates" roots rendered as non-editable (no rename/move/delete
affordances — `M13.1.1`'s `protected` flag drives this), everything beneath
them fully interactive. Also update the export/import selection panel
(`project-settings-export.component`, `M11.3`) so templates become a fourth
tree scope instead of `M11.3.1`'s flat searchable lists.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-templates-folder-tree.md](001-templates-folder-tree.md) | — |
| 2 | [002-template-creation-and-move-ui.md](002-template-creation-and-move-ui.md) | 1 |
| 3 | [003-export-import-panel-template-tree.md](003-export-import-panel-template-tree.md) | — |

Tasks 1–2 (Templates screen) and task 3 (export/import panel) touch
different components and can be built in parallel.

## Feature exit criteria

- [ ] `templates.component` shows a folder tree per kind (or a single tree
      with both fixed roots visible at once — see `001`'s notes for the
      exact layout decision), with the two fixed roots rendered distinctly
      as non-editable and every folder beneath them supporting
      create/rename/move/delete, matching the Pages/Media folder-tree UX.
- [ ] Creating a template offers (or defaults sensibly to) a target folder;
      an existing template can be moved between folders from the UI.
- [ ] `project-settings-export.component`'s template section becomes a tree
      scope (checkbox tri-state per folder, matching `PAGE`/`MEDIA`/
      `PAGE_REFERENCE`'s existing `CheckState` model) instead of `M11.3.1`'s
      flat searchable list — the two flat template lists and their
      dedicated UI are removed once the tree replaces them.
- [ ] No `window.prompt(...)` calls are introduced for template folder
      naming — reuse whatever the Pages/Media folder-creation flow uses
      today (a plain prompt is today's actual state for those too, per
      `M12`'s findings — if `M12`'s shared "Create asset" dialog has landed
      by the time this task starts, use it instead of adding a fourth
      `window.prompt` call; if not, matching the existing Pages/Media
      pattern is acceptable and not a regression).

## Dependencies

`M13.1` (backend folder API for templates). Existing Pages
(`folder-node.component`, `folder-detail.component`) and Media
(`media-folder-node.component`) folder-tree components as the UX/structure
reference — each store owns its own folder-node component today (no shared
one), and this feature follows that precedent. `TemplatesService`,
`ApiClient.listFolders`/`createFolder`/`move` (already generic across
scopes). `project-settings-export.component`'s existing `CheckState`
tri-state tree-selection model (`M11.3.4`).

## Notes

- If `M12`'s "asset metadata editing" work (UID rename, folders getting a
  detail drawer) has landed by the time this feature starts, give template
  folders the same metadata-editing treatment Pages/Media/Navigation
  folders get there, for consistency — but that's a nice-to-have carried
  over from `M12`'s own bar, not a new requirement invented by this
  milestone; don't block this feature on it.
