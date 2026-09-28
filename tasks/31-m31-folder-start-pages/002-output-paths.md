---
id: M31.2
status: todo
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
  effective start page per (locale, folder) cached for the run (render threads read it concurrently).
- `LiveOutputPathResolver`: the same from the live folder version and the live pointer page.
- `SF-GEN-0112` warning once per (folder, locale) for folders that hold a page of the plan in that locale and whose
  pointer is set but not effective.

## Acceptance criteria

- [ ] `OutputPathExpanderTest`: start page wins over the template `outputPath`; `pathOverride` wins over the start page;
      `indexUid` page with and without a start page in its folder; pretty/directory form; localized; `indexFileName`.
- [ ] `PaginationPathTest`/`OutputPathExpanderTest`: page 2 of a start page is `index-2.html`.
- [ ] `OutputPathResolverTest`: flags from the snapshot, per locale (released in one locale only → fallback there).
- [ ] Live resolver: a start page's PREVIEW URL is the folder index.
- [ ] Real build (`FolderStartPageGenerationIntegrationTest`): "Homepage" (template with its own `outputPath`) as start
      page of `pages_root` → `index.html`; pretty + trailing slash → `index.html` and links `./`; localized
      `de/index.html`/`en/index.html`; paginated start page `index-2.html`; `pathOverride` wins; a subfolder start page
      → `products/index.html`; stale pointer (moved away / not released in one locale) → fallback to the `index` page
      and `SF-GEN-0112` in that locale only.
- [ ] Backstop: a page `index` created in the folder after the start page was set → the build fails with
      `SF-GEN-0110` naming both pages.
- [ ] `./gradlew build` green.

## Out of scope

- Links to folders, navigation, URL registry invalidation (M31.3); planner (M31.4).

## Notes / hazards

- The start page's folder index path uses `indexStem` + `{ext}` exactly like today's `indexUid` page, so both rules
  produce the same file for the same channel.
