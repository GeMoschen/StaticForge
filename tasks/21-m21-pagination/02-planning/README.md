# Feature: Planning N outputs per page

**Spec:** Extends §18.1 (trigger and scope), §18.2 (stages: plan, validate), §18.3 (output
paths), §17.3 (sitemap / search index post-processors).

## Goal

Make the build plan express "page P, channel C, page number n". Compute the page count from the
snapshot before rendering, resolve each page's output path, and keep everything downstream of
the plan (collision detection, dependency tracking, reference materialization, sitemap, search
index, URL registry) correct when one page yields several files.

Shape of the change:

- `PlanEntry(pageUuid, channel, outputPath)` gains a `Pagination` component, `null` for
  non-paginated pages. It carries `pageNumber` (1-based), `totalPages`, and the resolved output
  paths of first/prev/next/last, so the renderer never recomputes them.
- One shared `PaginationSource` resolver (sf-generate, snapshot-based) turns a stored
  `PAGINATION` value into an ordered, eligible item list. The planner uses it for the count and
  the renderer (`M21.3.1`) for the slice.
- Pages 2..N get paths from a per-channel **pagination path pattern** on the page template
  (`payload.paginationPath.<channel>`, next to the existing `outputPath.<channel>`), expanded by
  `OutputPathExpander` with a new `{pageNumber}` placeholder.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-planner-page-fanout.md](001-planner-page-fanout.md) | `M21.1.1`, `M16.4.1`, `M16.3.3` |
| 2 | [002-site-outputs-canonical.md](002-site-outputs-canonical.md) | 1 |

## Feature exit criteria

- [x] A paginated page yields `max(1, ceil(items / pageSize))` plan entries per channel. Page 1
      uses the page's normal output path.
- [x] `OutputPathResolver.findCollisions` detects collisions between paginated outputs and any
      other page's outputs (`SF-GEN-0110`).
- [x] Render dependencies are merged per page across all its entries and channels; nothing is
      overwritten.
- [x] Incremental runs rebuild a paginated page when its source folder / dataset or any item in
      it changes, and remove no-longer-produced page-N outputs from the published build.
- [x] Sitemap, search index and generation report include every paginated output, with prev/next
      and canonical data available.

## Dependencies

`M21.1.1` (stored value + validation), `M16.4.1` (channel path settings actually used by
generation), `M16.3.3` (revision-aware reference queries used by `BuildPlanner.affectedPages`),
`M19.3.1` (dataset query model; dataset branch only).
