---
id: M32.3
status: done
depends: [M32.2]
epic: m32-complete-url-registry
feature: generation-outputs-and-links
area: backend
---

# M32.3 — Generation: registry-driven outputs and links

## Context

`OutputPathResolver`, `BuildPlanner`, `RenderPipeline`, `GenerationRenderer` (`navHref`, `$CMS_REF` kinds `page`,
`media`, `folder`, `resolveFolder`, `resolveMedia`), `MediaOutputs`, pagination fan-out (M21), `BuildManifest`,
post-processors (`SitemapPostProcessor`, `RobotsPostProcessor`, `HtmlStubPostProcessor`, `SitePage`), canonical /
hreflang, `QualityCheckStage` / `LinkResolver`, `DraftCheckService`. Epic decisions 3, 4, 5; user decisions 2, 4, 5,
12, 14.

## Goals

- Every output of a build is registered in `GENERATED` per channel and locale: each page, each paginated page
  (2..N), each media file and variant (per locale), each index-less folder that a page links to or that the plan
  touches.
- The registered URL is authoritative: the page/media file is **written** at it. `OutputPathResolver` answers
  "registry first, computed only for the first assignment" (the `computed` supplier keeps using the released
  snapshot's path, M27.2.1), so the plan's output paths, the manifest, the redirects stage, sitemap/robots/stubs,
  canonical and hreflang, and the link checker see the same URL.
- `$CMS_REF(page:…)`, `$CMS_REF(media:…)` (incl. `variant`), `$CMS_REF(folder:…)` and navigation hrefs resolve through
  the registry (derived targets per M32.2), relative to the rendering page.
- A first assignment that collides fails the build with `SF-GEN-0110` (like a path collision), naming both targets.
- Preload the build's rows per (channel, locale) at build start and write new rows in batches.

## Acceptance criteria

- [x] Full build of a fixture with pages, a paginated page, media with variants, two locales and two channels: a
      GENERATED row for every output; files on disk exactly at the registered URLs.
- [x] Moving a page (no reset) and rebuilding FULL: file stays at the old URL, links unchanged.
- [x] Overriding a page/media URL and rebuilding: file written at the override, every link, nav entry, sitemap line,
      canonical and hreflang points there; link checker finds no broken link.
- [x] Two targets computing the same URL: second one `SF-GEN-0110`, first unaffected.
- [x] Draft check (`DraftCheckService`) and dry-run plan show registry URLs without inserting rows (read-only).
- [x] 5,000-page full build within +15 % of pre-M32.
- [x] `./gradlew build` green.

## Out of scope

- Incremental planning after override/reset, redirects, removal (M32.5); preview (M32.4).

## Notes / hazards

- `RenderPipeline.validate()` and the draft check pass `urlRegistryService == null` today — keep a read-only mode for
  them that never inserts (a dry run must not assign URLs).
- Media is copied once per locale (M27.3.2); the copy target must be the registered URL too, not only the links.
- Pagination: rows for pages above the current count are cleaned up in M32.5; here only make sure the fan-out asks
  the registry for every page number.
