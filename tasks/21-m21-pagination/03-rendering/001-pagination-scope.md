---
id: M21.3.1
status: done
depends: [M21.2.1, M21.2.2, M16.1.1, M16.2.2]
epic: m21-pagination
feature: rendering
area: backend
---

# M21.3.1 — `CMS_PAGINATION` scope in `RenderContext`, generation + preview, golden tests

## Context

- `RenderContext` (`server/sf-template/.../template/render/RenderContext.java`) holds `channel`,
  `escaping`, `values`, `pageValues`, `meta`, `urlResolver` and `blockResolver`.
- `OctlRenderer.resolve` looks names up in this order: `CMS_PAGE` → `pageValues`, loop variables, `$CMS_SET`
  variables, then `context.values()`.
- `OctlCompiler.checkAccessorRoot` flags unknown roots as `SF-TPL-0103` whenever a
  `ContentDefinition` is present, with `CMS_PAGE` exempt.
- `$CMS_FOR` iterates any JSON array that `resolve()` returns (`OctlRenderer.resolveForList`),
  with `_index/_first/_last/_count/_depth`.
- Generation: `GenerationRenderer.render(entry)` builds the page context (meta `uid, uuid,
  displayName, path, revision, channel, projectKey`, with `path` = `entry.outputPath()`) and
  resolves URLs with `relativeUrl(pagePath, sitePath)`.
- Preview: `PageRenderService.renderPage(projectId, pageUuid, revision, channel,
  rewriteLinks[, baseUrl])` returns one `String`, served by `PreviewController`
  `GET /pages/{uuid}`, `GET /pages/{uuid}/share` and `GET /share`.
- Golden tests: `GoldenFileRenderTest` loops over `src/test/resources/render/<case>/`
  (`template.octl`, `content.json`, `expected.html`) with no resolver and no `BlockResolver`.

## Goals

- `RenderContext` gains an optional `pagination` `JsonNode`, built by the caller, never by the
  renderer.
- `OctlRenderer.resolve` handles the `CMS_PAGINATION` root: missing node when absent, otherwise
  path navigation into the node.
- `OctlCompiler.checkAccessorRoot` whitelists `CMS_PAGINATION`, as it does `CMS_PAGE`.
- `$CMS_META(pageNumber)$` and `$CMS_META(totalPages)$` are added for convenience (both absent
  on non-paginated pages).
- Generation (`GenerationRenderer.render`): when `entry.pagination() != null`, slice the resolved
  item list from `M21.2.1` (the same list that produced the count; do not re-resolve).
  - Build items:
    - nav: `uuid`, `uid`, `displayName`, `label` (same label rules as
      `NavigationServiceImpl.label()`), `href` (relative to `entry.outputPath()`), `date`, and
      the target page's content values under `content`, read through `M16.2.2`'s asset value
      resolver.
    - dataset: the record content plus `uid`/`uuid`.
  - Build `first/prev/next/last/canonical` hrefs and `pages[]` with `relativeUrl(entry.outputPath(), …)`.
  - Record the source and all items as dependencies (see `M21.2.1`).
- Section renders inside a paginated page (`renderSection`, catalog cards, includes) inherit
  the `pagination` node, so a "post list" section template can read `CMS_PAGINATION.items`.
- Preview (`PageRenderService` + `PreviewController`):
  - Add optional `page` query parameter (default 1, clamped to `1..total`) on
    `GET /pages/{uuid}` and the share endpoints.
  - Resolve pagination with the same `PaginationSource` semantics against live/revision data.
  - In rewrite-links mode, prev/next/page hrefs point at the preview URL with `page=n`.
  - Add `pageNumber` to the share token (`PreviewTokenService.issueShareToken` /
    `ShareTarget`) only if the share link should pin a page; otherwise pass it as a plain
    query parameter. Decide, and document the choice in the preview docs.
  - The response advertises `X-SF-Total-Pages` so the UI (`M21.4.1`) can offer a page selector
    without a second call.
- Golden tests, each with a `pagination.json` fixture next to `content.json`:
  - Cases: `pagination-first`, `pagination-middle`, `pagination-last`, `pagination-single`,
    `pagination-empty`, and `pagination-section-inherit`.
  - Extend `GoldenFileRenderTest` to load the optional `pagination.json` into the context.
  - Add a Markdown-channel case under `render-md/`.
- Unit tests:
  - generation: hrefs are relative from a nested pagination path (`blog/page/2/index.html` →
    `../../index.html` for first, `../3/index.html` for next);
  - preview: `?page` clamping and link rewriting.

## Acceptance criteria

- [x] `$CMS_FOR(post : CMS_PAGINATION.items)$…$CMS_END_FOR$` renders exactly items 11–20 on page 2
      of a size-10 pagination, in the planned order.
- [x] `prevHref`/`nextHref` are empty strings on page 1/last page respectively.
      `$CMS_IF(CMS_PAGINATION.nextHref)$` behaves accordingly.
- [x] Every generated pagination href resolves to an existing output file. A link-checker style
      test resolves each href against its page path (per `tasks/lessons.md`).
- [x] A template using `CMS_PAGINATION.*` compiles without `SF-TPL-0103` in both page and section
      templates; on a non-paginated page the accessors render empty.
- [x] `GET /preview/pages/{uuid}?page=2` renders page 2; `?page=99` renders the last page;
      `X-SF-Total-Pages` is set.
- [x] All new golden cases pass; existing golden cases are unchanged.
- [x] `./gradlew :server:sf-template:test :server:sf-generate:test :server:sf-domain:test :server:sf-api:test` green.

## Out of scope

- UI page selector and pagination editor (`M21.4.1`).
- A built-in "pager" HTML helper instruction. Templates compose it from `pages[]`; add a
  documented snippet instead.
- Locale-aware item labels/dates (`M24.3.3`).

## Notes / hazards

- **Relative URLs, always.** Pages 2..N live in deeper directories than page 1. Never build
  hrefs by string concatenation; every href goes through `relativeUrl(entry.outputPath(), target)`.
  This is the exact class of bug recorded in `tasks/lessons.md`.
- Including target-page `content` in nav items can be expensive for large page sizes. Resolve
  lazily through the asset value resolver (only fields the template accesses) if `M16.2.2`
  supports it; otherwise cap the included fields and document it.
- Keep `CMS_PAGINATION` read-only: `$CMS_SET(CMS_PAGINATION = …)$` must be a compile error, like
  shadowing `CMS_PAGE`.
- Preview and generation must slice identically. Share one slicing/href-building helper
  between `GenerationRenderer` and `PageRenderService` rather than copying it, avoiding a repeat
  of the triplicated `assetTypeForRef`.
