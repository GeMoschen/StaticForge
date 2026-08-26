# Feature: Import/Export settings UI

**Spec:** New capability; UI counterpart to §26.5, following the project-settings tab
pattern already established for Media, Channels, Generation, Revisions and Navigation
URLs (`M8.2.5`).

## Goal

Give project admins a dedicated "Import / Export" tab under Project Settings where
they can (a) pick specific assets/folders and settings to export and download a ZIP,
and (b) upload a ZIP, review a conflict report, and explicitly confirm or cancel before
anything is imported. No raw HTTP calls should be needed for either direction anymore.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-export-import-service.md](001-export-import-service.md) | M10.1.3, M10.2.3 |
| 2 | [002-export-panel.md](002-export-panel.md) | 1 |
| 3 | [003-import-conflict-panel.md](003-import-conflict-panel.md) | 1 |
| 4 | [004-settings-tab-wiring.md](004-settings-tab-wiring.md) | 2, 3 |

## Feature exit criteria

- [ ] A new "Import / Export" project-settings tab exists, matching the visual/
      interaction quality of the existing tabs.
- [ ] Export panel: a tree/list of the project's folders and assets with checkboxes
      (folder checkbox selects its subtree), plus separate toggles for "Include output
      channels" and "Include generation targets"; an Export button triggers a
      selective export and downloads the resulting ZIP.
- [ ] Import panel: file picker → "Analyze" runs automatically (or on an explicit
      button) → a conflict report renders grouped by severity, with clear per-item
      copy → "Cancel" aborts with no server call beyond the read-only analyze; "Import"
      is disabled while any blocking conflict is present and otherwise commits.
- [ ] Loading, empty, and error states throughout (network failure, malformed archive,
      0 elements selected) are handled with real UI, not console errors.

## Dependencies

`M10.1` (export selection API), `M10.2` (analyze/conflict API), and the settings-shell
tab-routing pattern from `M8.2.5` (`project-settings-shell.component`,
`project-settings-url-registry.component` as the most recent reference
implementation).
