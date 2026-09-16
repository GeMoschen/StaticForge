# Feature: Search UI

**Spec:** Extends §23.2 (Angular features), §24.5 (core screens) and §24.6 (interaction rules:
keyboard-driven, "errors carry the fix") and §24.7 (WCAG 2.2 AA). It fills in the command palette
that `M3` shipped as a stub.

## Goal

Make search reachable from anywhere, keyboard-first:

1. **Command palette.** `core/ui/command-palette/command-palette.component.*` is already mounted in
   `app.component.html` and opened by `ShortcutService` (Ctrl/Cmd+K and Shift+?). It currently
   renders an autofocused input with no logic. It becomes a quick-open over `GET /search`, with a
   debounced query, results grouped by type, arrow-key navigation, Enter to open, and Esc to close.
   Inside a project it searches that project. Outside a project (dashboard) it shows a hint instead
   of results, because search is project-scoped.
2. **Search page.** `p/:projectKey/search?q=…&type=…&folder=…&page=…`: URL-driven state, type facets
   with counts, a folder filter, paging, and highlighted snippets. The palette's "See all results"
   footer links here.

Opening a result must land on that asset for every type. Today `app.routes.ts` only deep-links pages
(`pages/:uuid`); media, navigation and templates have no per-asset route. This feature adds
query-param or child-route deep links for those, reusing the existing drawers/detail panes.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-command-palette.md](001-command-palette.md) | M23.3.1 |
| 2 | [002-search-page.md](002-search-page.md) | M23.3.1 |

## Feature exit criteria

- [ ] Ctrl/Cmd+K inside a project opens the palette. Typing shows grouped results within the
      debounce window, and Enter opens the selected asset in its editor/drawer.
- [ ] Every asset type returned by search has a working deep link (page editor, media drawer,
      navigation reference/folder detail, template IDE, plus globals/records/datasets once those
      stores exist).
- [ ] The search page state is fully URL-driven, so reload and back/forward restore it.
- [ ] Keyboard-only and screen-reader use works: combobox/listbox ARIA pattern, visible focus,
      announced result counts.
- [ ] During time travel both surfaces show "Results reflect the current revision".

## Dependencies

`M23.3.1` (endpoint + regenerated `schema.d.ts`). `M17.4.1`/`M19.4.*` stores provide the
routes for the global-set and record deep links.
