# M21 — Pagination

**Spec:** Extends §14.3 (editor types), §16 (OCTL scopes), §17 (navigation), §18.1–§18.3
(planning, stages, output paths), §19 (preview). Not part of the original §27 roadmap. It was
added the same way `M8`–`M15` were, as a user-requested capability on the post-v1 feature roadmap
(`tasks/todo.md` → "Feature roadmap M16–M24").

## Goal

Today one page renders to exactly one output file per channel. `PlanEntry(pageUuid, channel,
outputPath)` is the whole plan unit (`sf-generate/.../generate/plan/PlanEntry.java`), and
`BuildPlanner.plan` adds one entry per page per channel. Neither `GenerationRenderer.render`
nor `PageRenderService.renderPage` has any notion of "page N of M". A listing page, such as a
blog index over 200 posts, therefore has to render every item on one huge page or hard-code a
slice.

This milestone lets one page produce **N output files**: `blog/index.html`,
`blog/page/2/index.html`, …, `blog/page/N/index.html`. Each file renders one slice of an ordered
item source.

**User decision (2026-09-15):** pagination is declared through a new **CDL editor type
`pagination`** that a developer places in a page template. The source (a navigation folder or,
after `M19`, a dataset), page size and sort are stored as that editor's **value**, so an editor
picks them per page. They are content, not template code, which means the item count is known
from the snapshot **before rendering**. The planner can then emit all N plan entries up front,
and collision detection (`SF-GEN-0110`), incremental builds, sitemap and search index all keep
working on a fully known plan. An OCTL-only `$CMS_PAGINATE$` instruction was rejected because
the page count would only be discovered during rendering.

Templates read the current slice through a new read-only scope:

```
$CMS_FOR(post : CMS_PAGINATION.items)$ … $CMS_END_FOR$
$CMS_IF(CMS_PAGINATION.nextHref)$<a rel="next" href="$CMS_VALUE(CMS_PAGINATION.nextHref)$">Next</a>$CMS_END_IF$
```

## Exit criteria (epic is done when)

- [x] A page template can declare exactly one `editor pagination <name> { … }`. CDL validation
      rejects a second one, and rejects it in a section template.
- [x] A page whose pagination value points at a navigation folder with `k` eligible items and
      page size `s` generates `max(1, ceil(k / s))` output files per enabled channel. Page 1 is
      written to the page's **normal** output path (unchanged from today). Pages 2..N go to the
      paths produced by the template's pagination path pattern (`{pageNumber}` placeholder).
- [x] The same works for a dataset source once `M19` is done. The navigation source does not
      depend on `M19`.
- [x] `$CMS_PAGINATION.items / current / total / pageSize / itemCount / firstHref / prevHref /
      nextHref / lastHref / pages[]$` render correctly on every page. All hrefs are relative to
      the page being rendered (`GenerationRenderer.relativeUrl`, see `tasks/lessons.md`).
- [x] A paginated output path that collides with another page's path fails the run with
      `SF-GEN-0110`, the same as a normal collision.
- [x] Render dependencies are recorded per plan entry, not overwritten per page (today
      `RenderPipeline` does `dependencies.put(entry.pageUuid(), …)`). An item added to or
      removed from the source rebuilds the paginated page in an incremental run, including
      when the page count changes.
- [x] Sitemap and search index list every paginated output. Pages 2..N carry
      `rel="prev"/"next"` data and a self-referencing canonical, so templates can emit them.
- [x] Preview renders any page number (`?page=n`), and the page editor offers a page selector
      for paginated pages.
- [x] Golden-file render tests cover first, middle, last, single and empty pages. `./gradlew build`
      and `ui` `npm run build` are green; the M21 E2E journey passes against a running app.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [cdl](01-cdl/README.md) | backend | — |
| 2 | [planning](02-planning/README.md) | backend | 1, `M16.4.1` |
| 3 | [rendering](03-rendering/README.md) | backend | 2, `M16.1.1` |
| 4 | [ui](04-ui/README.md) | frontend | 1, 3 |
| 5 | [docs-e2e](05-docs-e2e/README.md) | qa | 2, 3, 4 |

## Dependencies

- `M16.4.1`: channel path settings (index file name, trailing slash, URL strategy) wired into
  `OutputPathResolver`. The default pagination path pattern (`…/page/{pageNumber}/index.html`)
  only makes sense once the index file name and pretty-URL settings are real rather than
  hardcoded (`GenerationService` currently calls `OutputPathResolver.forSnapshot(snapshot,
  "index", false, "DEFAULT")`).
- `M16.1.1`: compile cache. N renders of the same page must not recompile its template N
  times.
- `M16.3.3`: revision-aware reference queries. Incremental rebuild of a paginated page when
  its source changes relies on source→page edges being current rather than accumulated.
- `M19.3.1` / `M19.3.2`: dataset query model and `dataset:` resolution. These are needed **only**
  for the dataset source. Every task keeps the dataset branch behind this dependency, so the
  navigation source can ship first.
- `M24.3.2` (later): locale fan-out will multiply pagination entries by locale. Nothing here
  may assume `(pageUuid, channel, pageNumber)` is the full plan key forever; keep the key a
  record that can grow.

## Notes

- **The page count is content.** It comes from the pagination editor's value plus the source's
  state at the snapshot revision. The planner must compute it with the **same** item
  eligibility and ordering function the renderer uses to slice items. Implement one shared
  `PaginationSource` resolver used by both, never two copies (the duplicated `assetTypeForRef`
  in generation, preview and template save is the anti-pattern to avoid).
- **Page 1 keeps the page's normal path.** Links from navigation, `$CMS_REF(page:blog)$`, the
  URL registry and existing bookmarks must all keep pointing at page 1 without change.
- **An empty source still produces one page**, with `items=[]` and `total=1`, so an empty blog
  index does not become a 404.
- **Ordering must be total.** Every sort key ends with a `uid` then `uuid` tiebreak. The
  existing `NavigationServiceImpl.PAGE_ORDER`/`FOLDER_ORDER` comparators are the precedent.
  Unstable order would move items between pages across builds and create spurious incremental
  diffs.
- **Pre-existing bug surfaced here:** `RenderPipeline.renderParallel` stores
  `dependencies.put(entry.pageUuid(), task.file.dependencies())`. A page rendered for two
  channels already loses one channel's dependencies today. `M21.2.1` fixes it by merging per
  page, which is required once one page has N entries per channel.
- Navigation tree children are ordered with `FOLDER_ORDER` (display name, uid) in
  `NavigationServiceImpl.buildNode`, even for page references, while `nav.position`
  (`PAGE_ORDER`) is used only in `firstNavigablePage`. The pagination `sort` options must
  document which order "navigation order" means and must not silently change what
  `$CMS_NAVIGATION` renders.
- Out of scope for the whole epic: infinite scroll / client-side paging, pagination of section
  templates, more than one pagination editor per page template, and "load more" JSON
  endpoints.

## Implementation notes (2026-09-16)

Evidence and deviations; the code is the source of truth where they differ from the task files.

- **Default paths (user decision).** Pages 2..N are sibling files in every channel (`news/blog.html` →
  `news/blog-2.html`, pretty `news/blog/index.html` → `news/blog/index-2.html`), not `page/N/index.html`. A page
  template's `paginationPath.<channel>` overrides it with `{pageNumber}` (required) and `{pagePath}` (page 1's path
  without extension). Pagination paths are never prettified.
- **Diagnostic codes.** `SF-CDL-0110` placement (list/group, section template, property set, dataset schema),
  `SF-CDL-0111` second pagination editor (own or inherited), `SF-TPL-0163` `CMS_PAGINATION` read-only,
  `SF-GEN-0412` warning for a dangling reference in a navigation source.
- **No per-page dependency map.** `RenderPipeline` no longer stores `dependencies.put(pageUuid, …)` (incremental builds
  walk `asset_reference` since M16.3), so the "overwrite bug" doesn't exist any more. Incremental correctness is in
  `BuildPlanner`: a visited page reference queues the pages paginating its current and previous folder, a record the
  pages paginating its dataset, and the source itself reaches them over the `CONTENT_REF` edge. Each run stages a fresh
  build directory, so a shrunk pagination leaves no stale page (tested).
- **One model.** `pagination.PaginationValue`/`PaginationSource`/`PaginationScope` in sf-domain, used by the planner
  (`SnapshotPagination`), `GenerationRenderer` (slices the planner's items from `PlanEntry.Pagination`) and
  `PageRenderService`. `LiveOutputPathResolver` wasn't extended: preview links go to preview URLs and the URL registry
  only ever targets page 1.
- **`nav.visible`.** Pagination skips target pages with `nav.visible=false`; `$CMS_NAVIGATION` doesn't read the flag
  (documented).
- **Pre-existing bug fixed:** a build failure raised as a problem (the `SF-GEN-0110` collision) was reported as
  `SF-GEN-0501 "Build Failed"`, dropping the code and the colliding paths; the run report now keeps both.
- **Golden cases.** `pagination-first/middle/last/single/empty` and `render-md/pagination-markdown`. Section inheritance
  can't be a golden case (the harness has no block resolver); `PaginationIntegrationTest` renders the items through an
  included section template.
- **UI.** The source is picked in `sf-asset-picker-dialog`, which gained two types offered only when asked for by name:
  *Navigation folders* (the store's tree, loaded fresh, searchable with ancestors kept) and *Datasets*. The editor shows
  "N items → M pages" from `GET /pagination/count` (a new endpoint: the same `PaginationSource` and live resolvers as
  the preview; it reports skipped dangling references too). A disabled control (time travel, visual diff) shows a
  summary line (`Source: Blog · 10 per page · Date ↓`); this read-only path is covered by a component spec that can't
  run here and was not exercised live. The template IDE has a **Pagination paths** section (per channel, shown when the
  template declares or inherits a pagination editor, `{pageNumber}` checked inline and on the server).
- **Layout fix (pre-existing).** At a 1280 px window the page editor was wider than its column: the pages screen's
  `router-outlet + *` rule can't reach the routed host through style encapsulation, and `sf-preview-frame` couldn't
  shrink below its 1280 px desktop preset. The page editor host and the preview frame now set `min-width: 0` themselves
  (fieldsets also need `min-inline-size: 0`); the journey asserts the editor title, the pagination field, the page
  selector and Refresh are all on screen at 1280 px.
- **Limits.** `pagination-editor.component.spec.ts` can't run: the vitest JIT setup doesn't see signal `input()`s
  (`NG0303`/`NG0950`), the same environment issue as the 19 known `templateUrl` spec files. The initial bundle is
  about 832 kB (814 kB at M20), over the 819 kB warning budget, far under the error budget.

**Verification.** `./gradlew test spotlessCheck` (see `tasks/todo.md` review); new tests `PaginationCdlTest`,
`PaginationScopeRenderTest`, `PaginationValueValidationTest`, `PaginationSourceTest`, `PaginationScopeTest`,
`PaginationPathTest`, `PaginatedSitePagesTest`, `OutputPathResolverTest#paginatedOutputsAreOwnedByPageAndPageNumber`,
`PaginationIntegrationTest` (3: save validation, FULL/INCREMENTAL generation with a link check, sitemap/search index,
preview + `X-SF-Total-Pages`, collision, dataset source); UI util specs (9). `e2e/m21-journeys.spec.ts` passed against a
live dev backend + `ng serve` including the generated files and link check; m16–m20 journeys 16/16.
