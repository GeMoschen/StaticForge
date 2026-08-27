# Feature: Import/Export UI v2

**Spec:** UI counterpart to `M11.1`/`M11.2`, extending the "Import / Export"
project-settings tab shipped in `M10.3`.

## Goal

`project-settings-export.component` (`M10.3.2`) only ever showed the Pages
and Media folder trees, with its own doc comment explicitly scoping
Navigation and templates out. Wire up what `M11.1` makes possible on the
backend: navigation and template selection, and a one-click "select this
entire store" control per store. Every store that actually has a folder
hierarchy (Pages, Media, Navigation) is selected through the same tree view
with checkboxes — no store gets a different interaction model. That tree
must also show, live, which nodes are included only because they're an
ancestor of something the user actually picked (implicit) versus a node the
user — or a folder pick's own subtree — directly selected (explicit),
mirroring the same explicit/implicit distinction `M11.2.1` records in the
archive itself, so what the user sees before exporting matches what actually
gets written. Then give `project-settings-import.component` (`M10.3.3`) the
new `skipExistingImplicit` toggle from `M11.2.2`, with the conflict report
showing the same explicit/implicit distinction so the toggle's effect is
legible.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-navigation-template-pickers.md](001-navigation-template-pickers.md) | `M11.1.1`, `M11.1.2` |
| 2 | [002-select-all-stores-ui.md](002-select-all-stores-ui.md) | `M11.1.3`, 1 |
| 3 | [003-explicit-implicit-import-option-ui.md](003-explicit-implicit-import-option-ui.md) | `M11.2.2` |
| 4 | [004-explicit-implicit-tree-indication.md](004-explicit-implicit-tree-indication.md) | 1 |

## Feature exit criteria

- [ ] The export panel can select Navigation folders/entries and individual
      Page/Section templates, in addition to Pages/Media.
- [ ] Every store with a folder hierarchy (Pages, Media, Navigation) is
      selected through the same checkbox tree-view component — no
      store-specific interaction pattern. Templates, which have no folder
      hierarchy, remain a flat checkable list (see `M11.1.2`) — that's a
      structural fact about the data, not an inconsistency to "fix" into a
      tree with one level.
- [ ] Each store section has a one-click "select all" control that doesn't
      require expanding the tree first.
- [ ] In every store's tree, a node included only as ancestor padding is
      visually distinguished from a node included because it (or an
      ancestor folder pick covering it) was actually chosen — this applies
      to Pages/Media (already shipped in `M10.3.2`) as much as to the new
      Navigation tree, not just the stores this epic adds.
- [ ] The import panel has a `skipExistingImplicit` toggle (default off)
      that live-updates the conflict report, and each conflict row shows
      whether it concerns an explicit or implicit element.

## Dependencies

`M10.3` (`project-settings-export.component`, `project-settings-import.component`,
`import-export.service.ts`, the settings-tab wiring), `M11.1`, `M11.2`.
