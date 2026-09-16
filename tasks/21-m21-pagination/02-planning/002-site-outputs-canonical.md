---
id: M21.2.2
status: done
depends: [M21.2.1]
epic: m21-pagination
feature: planning
area: backend
---

# M21.2.2 — Sitemap, search index, URL registry and canonical data for paginated outputs

## Context

`GenerationService.sitePages(snapshot, plan, channels)` builds one
`SitePage(uid, path, channel, title)` (`sf-generate/.../generate/postprocess/SitePage.java`) per
plan entry. `SitemapPostProcessor` and `SearchIndexPostProcessor` iterate `ctx.pages()`. The
search index matches `page.path()` against output `.html` files and stores
`{uid, path, channel, title, text}` (500-char stripped text). `UrlRegistryService` stores URLs only
for `PAGE_REFERENCE` nav nodes (per channel + area) and always resolves a page to its page-1
path. After `M21.2.1`, the plan holds several entries per paginated page, so these consumers see
duplicate `uid`s with different paths and no page-number information.

## Goals

- `SitePage` gains nullable `pageNumber` / `totalPages` (compact constructor keeps existing call
  sites), filled from `PlanEntry.pagination()`.
- **Sitemap:** list every paginated output as its own `<url>`. Pages 2..N get the same
  `lastmod` as page 1. Order stays by path.
- **Search index:** index pages 2..N as separate entries with title suffix `" – page n"` (pattern
  configurable later; hard-coded format documented). Keep `uid` equal to the page's uid and add
  `pageNumber` so a client can collapse results.
- **URL registry:** unchanged. Navigation and `$CMS_REF` always target page 1. Add a test that
  pins this so a later change cannot silently point nav nodes at page N.
- **Canonical / prev / next data** is exposed to rendering (consumed by `M21.3.1`):
  - each page's canonical href is its own path (self-canonical, not page 1), and
  - `prevHref`/`nextHref` come from `PlanEntry.pagination()`.
  No HTML is injected by post-processors; templates emit `<link rel>` tags themselves. This keeps
  "no arbitrary markup injection" consistent with §16.1.
- **Generation report:** the files-written count includes paginated outputs, and the run
  details list paginated pages as `uid (n/N)` wherever the report enumerates pages.
- Tests: sitemap contains all N urls; search index entries for pages 2..N with `pageNumber`;
  URL registry and `$CMS_REF(page:blog)$` still resolve to page 1.

## Acceptance criteria

- [x] A 3-page paginated `blog` page appears 3× in `sitemap.xml` (per channel the sitemap covers),
      with correct absolute URLs built from the target `baseUrl`.
- [x] `search-index.json` holds 3 entries for it, carrying `pageNumber` 1/2/3; page 1's entry is
      unchanged in shape apart from the added field.
- [x] Navigation hrefs and `$CMS_REF(page:blog)$` resolve to page 1 on every page (test).
- [x] Non-paginated projects produce the same sitemap and search index as before (except the added
      nullable field, which is omitted when null).
- [x] `./gradlew :server:sf-generate:test` green.

## Out of scope

- `hreflang` alternates (`M24.3.2`).
- Rendering `<link rel="prev/next/canonical">` (templates do it via `$CMS_PAGINATION`, `M21.3.1`).
- Search index content for datasets/records themselves (`M23`).

## Notes / hazards

- `M22.4.1` changes incremental post-processing to use the full site page list rather than only
  planned entries. Whichever lands second must keep paginated outputs of **unchanged**
  paginated pages in the sitemap. Coordinate on a single "site outputs" source instead of two
  derivations.
- Self-canonical for pages 2..N is the current search-engine recommendation (canonicalising all to
  page 1 hides deeper items). Document the choice in the template developer guide.
