---
id: M31.3
status: todo
depends: [M31.2]
epic: m31-folder-start-pages
feature: consumers
area: backend
---

# M31.3 — Consumers follow the start page

## Context

`GenerationRenderer.resolveFolder` (`$CMS_REF(folder:…)`), `PageRenderService.urlResolver` (preview links),
`NavigationServiceImpl.firstNavigablePage` (folder entries and FOLDER-kind page references), URL registry
(`UrlRegistryServiceImpl`, assign-once rows; pattern `ChannelServiceImpl.update` deleting non-overridden rows),
§16.4, §17. Epic decisions 6, 9.

## Goals

- One notion of "the folder's index page" per view: the effective start page, else the folder's `indexUid` page
  (per channel), else none — shared by generation (snapshot) and live/preview callers.
- `$CMS_REF(folder:…)`: link the index page's URL (relative to the rendering page); without one keep the directory
  link, now without the `pages_root/` segment (existing bug).
- Preview: a folder link resolves to the index page's share link (today a page share token is issued for the folder
  uuid — existing bug); no index page → the current fallback.
- Navigation: FOLDER-kind page references and folder entries prefer the index page before "first navigable page".
- URL registry: a start-page change (`updateStartPage`, and a released folder version changing it) deletes the
  non-overridden GENERATED/PREVIEW rows of page references that resolve to the old or new start page or to that folder.

## Acceptance criteria

- [ ] `$CMS_REF(folder:…)` to `pages_root` and to a subfolder with a start page links `index.html` / `./` (pretty),
      without one the directory link; no `pages_root/` in any generated href.
- [ ] Preview folder link opens the start page.
- [ ] `M8NavigationJourneyIntegrationTest` / `NavigationUrlRegistryIntegrationTest` cases: a folder page reference
      resolves to the start page; changing the start page changes the cached href.
- [ ] `./gradlew build` green.

## Out of scope

- Planner edges (M31.4), UI (M31.5).

## Notes / hazards

- Keep links relative to the rendering page (lessons: "Generated links: relative to the current page").
