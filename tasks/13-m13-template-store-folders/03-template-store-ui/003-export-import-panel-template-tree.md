---
id: M13.3.3
status: todo
depends: []
epic: m13-template-store-folders
feature: template-store-ui
area: frontend
---

# M13.3.3 — Export/import selection panel: templates as a tree scope

## Context

`project-settings-export.component.ts` (`M11.3`) currently models three
tree scopes (`TreeScope = 'PAGE' | 'MEDIA' | 'PAGE_REFERENCE'`, mapped to
`StoreScope = 'PAGES' | 'MEDIA' | 'NAVIGATION'` via `STORE_SCOPE_FOR`) with
a tri-state `CheckState` model (`explicit`/`implicit`/`unchecked`) walked
over each scope's folder tree, plus a separate `TemplateType = 'PAGE_TEMPLATE'
| 'SECTION_TEMPLATE'` flat searchable-list path added in `M11.3.1` because
templates had no tree to show at the time. Now that they do (`M13.1`), fold
templates into the same tree-scope machinery instead of keeping a
second, differently-shaped selection UI.

## Goals

- Extend `TreeScope`/`StoreScope`/`STORE_SCOPE_FOR` with a `TEMPLATES`
  entry (deciding whether `PAGE_TEMPLATE`/`SECTION_TEMPLATE` are one tree
  scope with the fixed roots as its two branches, or the union type grows
  a distinct entry per kind — one tree scope matches the backend's single
  `FolderScope.TEMPLATES`, so prefer that unless the existing `CheckState`
  walk can't represent two independently-rooted branches under one scope
  cleanly; if it can't, revisit rather than forcing it).
- Remove the `M11.3.1` flat searchable-list UI/state for templates once the
  tree covers the same ground — don't leave both paths live.
- The two fixed folders render in this panel the same non-editable way
  `M13.3.1` renders them in the Templates screen (no rename/delete
  affordances here either — this panel's tree is read/select-only anyway
  for every scope today, so this is likely a non-issue; confirm rather than
  assume).
- `fullStores`/`ExportSelectionRequest` wiring: selecting the whole
  templates tree (or its "select entire store" convenience, if this panel
  already exposes one per scope — confirm against `M11.1.3`'s UI
  counterpart) sends `TEMPLATES` in `fullStores`, matching how the other
  three scopes already do.

## Acceptance criteria

- [ ] The export/import panel shows templates as a folder tree with the
      same tri-state selection UX as Pages/Media/Navigation.
- [ ] Selecting a template folder, a nested subfolder, or an individual
      template all produce the correct `ExportSelectionRequest` payload
      (`assetUuids`/`fullStores`), verified against `M13.2`'s backend
      behavior.
- [ ] The old flat template search/list UI is gone, not left dead alongside
      the new tree.
- [ ] Existing Pages/Media/Navigation tree behavior in this panel is
      unchanged.

## Out of scope

- Any change to the import-side conflict UI (`M10.3.3`) beyond what
  naturally falls out of templates now having folders (e.g. a
  `MISSING_PARENT_FOLDER` conflict becoming possible for templates the way
  it already is for Pages/Media/Navigation) — if the existing conflict
  rendering already handles that generically, no UI work is needed here;
  confirm rather than assume.

## Notes / hazards

- This component's tri-state tree-walk logic
  (`explicit`/`implicit`/`unchecked`) is intentionally generic per scope
  today — read it closely before extending; the goal is one more scope
  flowing through existing logic, not a parallel implementation for
  templates.
