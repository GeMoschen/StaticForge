---
id: M31.3
status: done
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

- [x] `$CMS_REF(folder:…)` to `pages_root` and to a subfolder with a start page links `index.html` / `./` (pretty),
      without one the directory link; no `pages_root/` in any generated href.
- [x] Preview folder link opens the start page.
- [x] `M8NavigationJourneyIntegrationTest` / `NavigationUrlRegistryIntegrationTest` cases: a folder page reference
      resolves to the start page; changing the start page changes the cached href.
- [x] `./gradlew build` green.

## Out of scope

- Planner edges (M31.4), UI (M31.5).

## Notes / hazards

- Keep links relative to the rendering page (lessons: "Generated links: relative to the current page").
- The index-page rule lives once, in `NavigationService.indexPage(projectId, folderUuid, lookup)`: the effective start
  page (the pointer names one of the folder's pages in the lookup's view, pages folders only), else the page whose UID
  is `lookup.indexUid()`. `NavigationLookup.indexUid()` (default `null`) and `withIndexUid(String)` (wrapper
  `ChannelNavigationLookup`) make a lookup channel-specific. Channel-aware callers: `GenerationRenderer` (folder links,
  `$CMS_NAVIGATION`), `PageRenderService` (folder links, navigation), `UrlRegistryServiceImpl.computeAndPersist`.
  `firstNavigablePage` prefers the index page of every folder it walks, so FOLDER-kind references and navigation folder
  entries (their `startNode` chain ends in a reference) follow.
- Channel-less lookups (the Navigation screen's tree/resolve endpoints, pagination sources, the page-reference
  validation) know start pages only; the `indexUid` fallback needs a channel, and the default `indexUid` (`index`) is a
  reserved UID anyway.
- `$CMS_REF(folder:…)` without an index page links `OutputPathExpander.folderUrl(folderPath, localeContext)`
  (`{locale}/{folder}`, `pages_root/` stripped, the root as `./`); the renderer's own `relativeFolder` is gone.
- Deviation: a preview folder link to a folder without an index page renders an empty href. The "current fallback"
  issued a page share token for the folder's uuid, which the share route can't render (a folder isn't a page), and a
  preview has no directory to show.
- URL registry: `StartPageUrlInvalidation` (sf-domain `urlregistry`) deletes, via the new
  `UrlRegistryRepository.deleteByProjectIdAndPageReferenceUuidInAndOverriddenFalse`, the computed rows (both areas,
  every channel and locale) of the page references with an open `NAV` edge to the old or new start page or the folder,
  plus references to an ancestor folder whose (draft) resolution now lands in the folder. Called from
  `AssetServiceImpl.update`/`restore` for every folder whose `startPage` changed (the start-page endpoint, discard,
  restore, and any import that writes through them) and from `ReleaseServiceImpl.release` when a folder is released
  with another start page than its released version.
- Seam for M31.4: a page with `$CMS_REF(folder:F)` depends on F's index page; the planner has to re-render F's
  referrers when F's start page changes (the changed folder's referrer walk) and when F's index page's output moves.
- Evidence: `./gradlew spotlessCheck build test --rerun -Pfrontend.skip=true` green (sf-app 927, 6 skipped as before;
  sf-domain 415; sf-generate 182; sf-api 22; sf-template 271); `FolderStartPageConsumersIntegrationTest` 7,
  `M8NavigationJourneyIntegrationTest` +1 case, `NavigationServiceImplTest` +5, `OutputPathExpanderTest` +2. No API change.
