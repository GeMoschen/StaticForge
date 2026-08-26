# Feature: Navigation store

**Spec:** Supersedes §17.1–§17.2 (structure asset, `navigation` kind only — breadcrumb
and list are dropped, see task 001).
**Area:** backend + frontend. **Epic:** M8.

## Goal

Delete the `structure` asset type and replace it with a navigation store: its own
folder tree (`FolderScope.NAVIGATION`) rooted like the Page/Media stores, plus a new
`PageReference` asset type that targets a `Page` or a page-store `Folder`. Expose a
`navigation` OCTL instruction so templates can render the tree.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-remove-legacy-structures.md](001-remove-legacy-structures.md) | — |
| 2 | [002-navigation-domain.md](002-navigation-domain.md) | 1, M1.3.x (asset/folder model) |
| 3 | [003-navigation-service.md](003-navigation-service.md) | 2 |
| 4 | [004-navigation-render-function.md](004-navigation-render-function.md) | 3, M2.4.2 (`BlockResolver`) |
| 5 | [005-navigation-api.md](005-navigation-api.md) | 3 |
| 6 | [006-navigation-ui.md](006-navigation-ui.md) | 5, M3.2.2 (tree UI pattern) |

## Feature exit criteria

- [x] No compiled class references `AssetType.STRUCTURE`, `StructureService`,
      `NavigationBuilder`, or `NavRenderer` (removed wholesale by task 001; confirmed no
      remaining `ui/` references either — `grep -rn "structures\|Structures" ui/src/app`
      is empty as of task 006).
- [x] A project's navigation folder tree and `PageReference` assets survive
      create/rename/move/delete with full revision history, exactly like Pages (backend:
      `NavigationApiIntegrationTest`, task 005; frontend: `ui/.../features/navigation/`,
      task 006 — wired to the same endpoints, not independently click-through-verified
      against a live stack in this environment, see task 006's Notes).
- [x] `$CMS_NAVIGATION(nav:<uid>)$` (see task 004 for final grammar) renders a nested
      list reflecting the tree, with folder-targeted references resolved to a concrete
      page URL (task 004).

## Dependencies

`M1` (asset identity, folders, revisions), `M2` (OCTL renderer, `BlockResolver`
extension point), `M5` (channels — a navigation render is always channel-scoped).
