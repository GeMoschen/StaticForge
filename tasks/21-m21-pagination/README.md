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

- [ ] A page template can declare exactly one `editor pagination <name> { … }`. CDL validation
      rejects a second one, and rejects it in a section template.
- [ ] A page whose pagination value points at a navigation folder with `k` eligible items and
      page size `s` generates `max(1, ceil(k / s))` output files per enabled channel. Page 1 is
      written to the page's **normal** output path (unchanged from today). Pages 2..N go to the
      paths produced by the template's pagination path pattern (`{pageNumber}` placeholder).
- [ ] The same works for a dataset source once `M19` is done. The navigation source does not
      depend on `M19`.
- [ ] `$CMS_PAGINATION.items / current / total / pageSize / itemCount / firstHref / prevHref /
      nextHref / lastHref / pages[]$` render correctly on every page. All hrefs are relative to
      the page being rendered (`GenerationRenderer.relativeUrl`, see `tasks/lessons.md`).
- [ ] A paginated output path that collides with another page's path fails the run with
      `SF-GEN-0110`, the same as a normal collision.
- [ ] Render dependencies are recorded per plan entry, not overwritten per page (today
      `RenderPipeline` does `dependencies.put(entry.pageUuid(), …)`). An item added to or
      removed from the source rebuilds the paginated page in an incremental run, including
      when the page count changes.
- [ ] Sitemap and search index list every paginated output. Pages 2..N carry
      `rel="prev"/"next"` data and a self-referencing canonical, so templates can emit them.
- [ ] Preview renders any page number (`?page=n`), and the page editor offers a page selector
      for paginated pages.
- [ ] Golden-file render tests cover first, middle, last, single and empty pages. `./gradlew build`
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
