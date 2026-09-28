---
id: M31.2
status: done
depends: [M31.1]
epic: m31-folder-start-pages
feature: output-paths
area: backend
---

# M31.2 — Output paths of start pages

## Context

`channel/OutputPathExpander` (`PageContext`, `expressionFor`, `expand`), `generate/render/OutputPathResolver`
(`toPageContext`, snapshot per locale), `urlregistry/LiveOutputPathResolver` (`pageContext`, live versions),
`RenderPipeline.execute` (collisions `SF-GEN-0110`, warnings), §18.3. Epic decisions 6–8, 13.

## Goals

- `PageContext` gains `boolean startPage` and `boolean folderHasStartPage` (a five-argument constructor keeps meaning
  "no start page in the folder").
- `expressionFor`: `pathOverride[channel]` → start page: the default expression (localized variant in a localized
  project) → template `outputPath` → default.
- `expand`: `{uid}` → `indexStem` for the start page, and for the `indexUid` page only when `!folderHasStartPage`.
- `OutputPathResolver`: the page's folder in the page's locale view (`snapshot.in(locale).assetById(folderId)`), the
  effective start page per (locale, folder) read from that view (two map lookups, no cache needed).
- `LiveOutputPathResolver`: the same from the live folder version and the live pointer page.
- `SF-GEN-0112` warning once per (folder, locale) for folders that hold a page of the plan in that locale and whose
  pointer is set but not effective.

## Acceptance criteria

- [x] `OutputPathExpanderTest`: start page wins over the template `outputPath`; `pathOverride` wins over the start page;
      `indexUid` page with and without a start page in its folder; pretty/directory form; localized; `indexFileName`.
- [x] `OutputPathExpanderTest`: page 2 of a start page is `index-2.html` (also `OutputPathResolverTest`).
- [x] `OutputPathResolverTest`: flags from the snapshot; stale pointer (moved away, unreleased page, folder absent from
      the view) → fallback. Per-locale views are covered by the real build (unit tests can't build a locale family).
- [x] Live resolver: a start page's PREVIEW URL is the folder index.
- [x] Real build (`FolderStartPageGenerationIntegrationTest`): "Homepage" (template with its own `outputPath`) as start
      page of `pages_root` → `index.html`; pretty + trailing slash → `index.html` / `products/index.html`, linked as
      `../` and `../products/` from `about/index.html`; localized `de/index.html`/`en/index.html`; paginated start page
      `index.html`, `index-2.html`, `index-3.html`; `pathOverride` wins; a subfolder start page → `products/index.html`;
      stale pointer (moved away / unpublished in one locale) → fallback to the `indexUid` page and `SF-GEN-0112` in that
      locale only.
- [x] Backstop: a page claiming the index path by its UID created after the start page was set → the build fails with
      `SF-GEN-0110` naming both pages.
- [x] `./gradlew build` green.

## Out of scope

- Links to folders, navigation, URL registry invalidation (M31.3); planner (M31.4).

## Notes / hazards

- The start page's folder index path uses `indexStem` + `{ext}` exactly like today's `indexUid` page, so both rules
  produce the same file for the same channel.
- Seams: `OutputPathExpander.PageContext(uid, displayName, folderPath, payload, templatePayload, boolean startPage,
  boolean folderHasStartPage)` (the 5-argument constructor = no start page; `startPage` implies
  `folderHasStartPage`); `OutputPathResolver.startPageOf(UUID folderUuid, String locale)` (effective start page in that
  language's view, `null` = fall back to `indexUid`) and `declaredStartPageOf(UUID folderUuid, String locale)` (the
  stored pointer when the folder is present in the view); `LiveOutputPathResolver.startPageOf(long projectId, UUID
  folderUuid)` (live drafts); `GenerationDiagnosticCodes.GEN_START_PAGE_UNAVAILABLE` = `SF-GEN-0112`.
- Deviation: the backstop is proven with a channel whose `indexFileName` is `start.html`: `index` is a reserved UID
  (`UidGenerator`), so no page can claim `index.html` by its UID in a default channel.
- `SF-GEN-0112` is a render warning, so like `SF-GEN-0220`/`0221` it makes the run `PARTIAL` until the pointer is fixed
  (released, cleared or the page moved back).
- For M31.3: URL-registry rows are assign-once; a nav href assigned before a start page was set keeps the page's old
  path until M31.3's invalidation lands (the build itself writes the new path).
- Evidence: `./gradlew spotlessCheck build -Pfrontend.skip=true` green (sf-app 919 tests, 6 skipped as before);
  `test --rerun` of sf-domain (408), sf-generate (182), sf-api (22), sf-template (271) green;
  `FolderStartPageGenerationIntegrationTest` 6, `OutputPathResolverTest` 19, `OutputPathExpanderTest` 15. No API change.
