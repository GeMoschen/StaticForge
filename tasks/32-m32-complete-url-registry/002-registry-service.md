---
id: M32.2
status: done
depends: [M32.1]
epic: m32-complete-url-registry
feature: registry-service
area: backend
---

# M32.2 — Registry service for every target

## Context

`UrlRegistryService`, `UrlRegistryServiceImpl`, `LiveOutputPathResolver`, `NavigationService.resolve`/`indexPage`,
`MediaOutputs`, `OutputPathExpander` (`folderUrl`, pagination). Epic decisions 2, 3, 5, 12; user decisions 3, 9, 10,
13, 14.

## Goals

- Generalize the API to `UrlTarget`: `resolve(target, channel, area, locale, Supplier<String> computed, ctx)` (assign
  once; an existing row is returned verbatim), `override(target, channel, area, locale, url, ctx)`,
  `reset(projectId, scope, ctx)`, `search(…)` with the new filters, `require(projectId, id)`, and a bulk
  `preload(projectId, channel, area, locale)` for builds.
- Derived targets: page references resolve to their target page (`NavigationService.resolve`), folders with an index
  page to that page (`NavigationService.indexPage` with the channel's `indexUid`); only then is the registry asked.
  Neither ever gets a row. One helper does it for all callers (generation, preview, API).
- Folders without an index page: `computed` = `OutputPathExpander.folderUrl(folderPath, locale)`.
- Media: channel-independent rows (`channel_key = ''`), one per locale and variant; `computed` from the media's output
  path / variant path.
- Pagination: page N's `computed` is the channel's pagination rule applied to page 1's **registered** URL (page 1 is
  resolved first).
- Collision: a first assignment whose URL is held by another target inserts nothing and returns a
  `UrlResolution.Collision(holder)`; callers decide (M32.3 → `SF-GEN-0110`, M32.4 → fallback). `override` onto a held
  URL → `409 SF-DOM-0200` (`holderType`, `holderUuid`); invalid override (empty, outside the channel root, wrong
  extension for a page, `..` segments) → `422 SF-DOM-0201`.
- Removal helpers: `deleteComputed(projectId, targetUuid[, locale])`, `deleteComputedPagesAbove(projectId, pageUuid,
  channel, locale, n)`.
- Remove the page-reference overloads; move `ChannelServiceImpl.update`'s invalidation (non-overridden rows of the
  channel) and `AssetServiceImpl.softDelete`'s cleanup onto the new API.

## Acceptance criteria

- [x] Unit tests: assign once per target kind; page reference and indexed folder return the page's row and create
      none; index-less folder gets the directory URL; media per variant/locale without channel; page 3 derives from
      page 1's registered (not computed) URL.
- [x] Collision on first assignment and on override (`SF-DOM-0200`), invalid override (`SF-DOM-0201`).
- [x] Channel output-settings change still deletes the channel's computed rows, overrides kept.
- [x] `./gradlew build` green.

## Out of scope

- Writing outputs at registry URLs (M32.3), preview wiring (M32.4), planner/removal hooks (M32.5), REST (M32.7).

## Notes / hazards

- The registry stores site-root-relative URLs as today; callers keep making links relative to the rendering page
  (lessons: "Generated links: relative to the current page").
- `RevisionContext` is still audit-only here; the change log for overrides/resets (`url_registry_change`) is added
  in M32.5.
