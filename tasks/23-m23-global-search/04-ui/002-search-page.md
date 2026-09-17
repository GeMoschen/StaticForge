---
id: M23.4.2
status: done
depends: [M23.3.1]
epic: m23-global-search
feature: ui
area: frontend
---

# M23.4.2 — Full search page with facets

## Context

`app.routes.ts` defines project child routes under `p/:projectKey` (`pages`, `pages/:uuid`, `media`,
`navigation`, `templates`, `settings/*`). There is no search route. The nav rail is
`dashboard/nav-rail.component.ts`. `M23.4.1` provides `SearchService` and the shared
`assetRoute(hit)` deep-link helper.

## Goals

- **Route and state.**
  - Add route `p/:projectKey/search` (lazy standalone component `features/search/search-page.component`).
  - State lives entirely in query params: `q`, `type` (repeatable), `folder`, `page`, `size`.
    Changing a control updates the URL (`replaceUrl` while typing, push on submit/facet change).
    Reload and back/forward restore it.
- **Layout:**
  - Search input (autofocus, submit on Enter, debounced live update).
  - Facet sidebar: type checkboxes with counts from `facets.types`, following drill-sideways counts
    from `M23.3.1`.
  - Folder filter using the existing folder picker/tree component for the chosen store, or a path
    prefix input if a type-agnostic picker doesn't exist.
  - Results list: icon, display name, uid, folder path, highlighted snippet, and `matchedIn` badge
    (Title/UID/Content/Source).
  - Paging controls.
- **Index status line.** Show `indexedRevision`/`latestRevision`. When lagging, show "Index is
  catching up (N revisions behind)".
  - `GET /search/status` state `REBUILDING`: show a banner.
  - `UNAVAILABLE`: show an explanatory empty state.
  - PROJECT_ADMINs additionally see a "Rebuild index" action calling `POST /search/reindex`, with
    a confirm dialog.
- **Empty and zero states.** No query shows a short hint of what is searchable. No results shows a
  suggestion to clear filters if any are active (§24.6 "errors carry the fix").
- **Nav rail.** A search entry, with the shortcut hint "Ctrl K" shown in its tooltip.
- **Time travel.** The same "current revision" note as the palette.
- Read-only for VIEWERs apart from the admin action gating. There are no mutations on this page
  other than reindex.

## Acceptance criteria

- [x] `p/:key/search?q=teaser&type=SECTION_TEMPLATE` loads with the query and filter applied. Toggling
      a facet updates results and URL; browser back restores the previous state.
- [x] Facet counts for unselected types remain visible when one type is selected.
- [x] Paging works and resets to page 0 when `q` or filters change.
- [x] Clicking a result uses `assetRoute` and opens the asset (same deep links as `M23.4.1`).
- [x] The Rebuild action is visible only for PROJECT_ADMIN (role from the project context store). It
      calls the endpoint, shows `REBUILDING`, and handles `409` with a toast.
- [x] Verified in the running app against the dev backend with a seeded project (see the project's
      local-run notes for ports/login), including a lagging-index state, which you can force by
      pausing the listener in dev if needed.
- [x] `npm run build` green; pure-logic specs (query-param ↔ state mapping) pass; `templateUrl`
      spec failures, if any, are the known tooling issue and recorded.

## Out of scope

- Saved searches, export of results, bulk actions on results.
- Cross-project search.

## Notes / hazards

- Query-param state with repeatable `type` needs consistent ordering to avoid history spam. Sort
  `type` values before writing to the URL.
- Keep the page usable at 400 px width (facets collapse into a disclosure above results).
