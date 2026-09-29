# M32 — Complete URL registry (every page, media and folder URL is assigned once and drives the output)

**Spec:** Extends the URL registry (M8.2, §15, §18, §19.2, §20.2, §24), §16.4 (references), §17 (navigation), §18.3
(output paths), §18.9 (redirects), §21 (pagination outputs), §26.5 (export protocol 11), Appendix B. Not part of the
original §27 roadmap — inserted the same way `M8`–`M31` were.

## Goal

Today the URL registry only knows navigation **page references**. Its key is `page_reference_uuid`
(`UrlRegistryEntry`), and it fills only when a navigation href is rendered (`GenerationRenderer.navHref`,
`PageRenderService` for preview). Everything else computes its URL directly and never reaches the registry:
`$CMS_REF(page:…)`, `$CMS_REF(media:…)` and `$CMS_REF(folder:…)` links (`GenerationRenderer` ~l. 492), pages that
nothing links to, paginated outputs (page 2..N), media variants. Preview also ignores the language: it calls `resolve`
without a locale, so PREVIEW rows are always the default language.

After M32 every output of a build and of the preview has a registry entry: every page (and every paginated page),
every media file (per variant and locale), and every folder without an index page. The entry is assigned once and is
**authoritative**: the file is written at the registered URL, and every link, navigation entry, sitemap line and
canonical/hreflang tag reads it. A move changes nothing until the entry is reset or overridden. Then the next
incremental build moves the file, re-renders the linkers, and the old URL gets an AUTO redirect.

## User decisions (2026-09-29)

1. **Targets:** pages, media, folders and paginated outputs.
2. **When:** every output a generation or preview produces is registered, whether or not anything links to it.
3. **Semantics:** assign once, as today — a row is never recomputed until it is reset or overridden.
4. **Links read through the registry:** `$CMS_REF(page:/media:/folder:)` and navigation hrefs use the registry value,
   so overrides apply everywhere.
5. **The registry drives the output:** the file is written at the registered (or overridden) URL, never at a
   differing computed path. Links and files never diverge.
6. **Media:** one entry per media, locale and variant. Media is channel-independent (see decision 9 below for the key).
7. **Folders without an index page:** entry = the directory URL (`OutputPathExpander.folderUrl`, the `$CMS_REF`
   fallback today).
8. **Preview:** registers and resolves per locale, like generation.
9. **Navigation page references:** derive from their target page's entry and have no own rows. Existing
   page-reference rows (computed and overridden) are **dropped**; the next build registers pages at their current
   paths.
10. **Folders with an index page:** derived from the index page's entry (no own row).
11. **Override / reset:** the next INCREMENTAL build re-renders the asset (moving its output), its linkers and
    navigation; the old URL gets an AUTO redirect (M30).
12. **Collisions:** an override onto a URL already registered for another target is refused (`409`); a first
    assignment that collides with an existing row fails the build with `SF-GEN-0110` (the existing collision code).
13. **Deleted / unpublished assets:** their computed rows are deleted; overrides are kept, so a restored or
    republished asset gets its chosen URL back.
14. **Pagination:** page N's first assignment applies the channel's pagination rule (`paginationPath`,
    `index-2.html`) to **page 1's registered URL**, so the pages stay together even when page 1 is frozen at an old
    path.
15. **Export/import:** a full-project archive carries every `GENERATED` row (computed and overridden, not `PREVIEW`).
    On import, a clash with an existing target row is resolved by an **import option chosen in the UI** (decision 9 of
    the binding decisions).
16. **UI:** the settings panel "Navigation URLs" becomes **"URLs"**, gains filters (asset type, locale, channel, area,
    search by asset name/path), and entries can be overridden/reset from the asset's own editor (page, media, folder).

## Findings from planning

1. `UrlRegistryEntry` (`url_registry_entry`, changelogs `014-url-registry.xml`, `018-url-registry-locale.xml`) is keyed
   `(project_id, channel_key, page_reference_uuid, area, locale_key)`; `UrlRegistryRepository.insertIfAbsent` is the
   only native query in the codebase (M23 note).
2. Registry reads: `GenerationRenderer.navHref` (GENERATED, locale-aware, `computed` supplier from
   `OutputPathResolver.resolvePageUrl`, M27.2.1) and `PageRenderService` (PREVIEW, no locale, only when
   `!rewriteLinks`). Invalidation: `ChannelServiceImpl.update` (output settings changed), `AssetServiceImpl.softDelete`
   (page reference deleted), reset API.
3. Paths are computed by `OutputPathResolver` (snapshot, sf-generate) and `LiveOutputPathResolver` (drafts,
   sf-domain) via `OutputPathExpander`. Media outputs: `MediaOutputs.of(uuid, locale)` / `variantPath(variant)`.
   Folder links: `GenerationRenderer.resolveFolder` → `NavigationService.indexPage`, else `OutputPathExpander.folderUrl`.
4. Consumers of output paths beyond links: `BuildPlanner.moved`, `ImpactService`, `BuildManifest`,
   `SitemapPostProcessor`, `RobotsPostProcessor`, `HtmlStubPostProcessor`, `SitePage`, `BuildRedirects` (AUTO
   redirects), `QualityCheckStage`/`LinkResolver` (link checks), `DraftCheckService`.
5. Export protocol is 10 (`QUALITY_AND_REDIRECTS_PROTOCOL`); M31's protocol 11 was removed again, so 11 is free.
   `ImportOptions` is the extensible options record (M11.2.2). Next Liquibase changelog: `030-…`.
6. Free codes: `SF-DOM-0200` onwards, `SF-GEN-0113` onwards.

## Decisions (binding for all tasks — revisit only with the user)

1. **Model.** `url_registry_entry` is re-keyed to
   `(project_id, channel_key, area, locale_key, target_type, target_uuid, variant_key, page_number)`:
   `target_type` ∈ `PAGE | MEDIA | FOLDER`; `target_uuid` replaces `page_reference_uuid`; `variant_key` is `''`
   except for media variants; `page_number` is `1` except for paginated outputs 2..N. Media rows use `channel_key = ''`
   (channel-independent). The unique constraint covers the whole key. A second unique index
   `(project_id, channel_key, area, locale_key, url)` enforces "one URL, one target" (decision 5).
   Liquibase `030-url-registry-all-targets.xml` **deletes every existing row** (user decision 9) and migrates the
   schema; `ResetScope` gains `ASSET` (all rows of one target uuid).
2. **Service API.** `UrlRegistryService` is generalized to a `UrlTarget(type, uuid, variant, pageNumber)`:
   `resolve(target, channel, area, locale, Supplier<String> computed, ctx)` (read-through, assign once),
   `override(target, …)`, `reset(scope)`. `PAGE_REFERENCE` and folders **with** an index page are resolved by the
   caller to their target page first (`NavigationService.resolve` / `indexPage`) and never get rows. The old
   page-reference overloads go away.
3. **Collision.** `resolve` that would insert a URL already held by another target in the same
   `(project, channel, area, locale)` does not insert and reports the clash: generation fails the build with `SF-GEN-0110`
   like any path collision, preview falls back to the computed URL and logs it. `override`
   onto a held URL answers **`409 SF-DOM-0200`** naming the holder (`holderType`, `holderUuid`); an override that isn't
   a valid path for the target (wrong extension for a page, outside the channel root, empty) is `422 SF-DOM-0201`.
4. **Authoritative output.** Generation writes each page (each paginated page), media file and variant at its
   registry URL. `OutputPathResolver` becomes "registry first, computed on first assignment": the render path, the
   plan's output path (`BuildPlanner`), the manifest, `BuildRedirects`, sitemap/robots/stubs, canonical/hreflang and
   the link checker all see the registered URL. The `computed` value is only used for a first assignment.
5. **Pagination.** Page N (N ≥ 2) is its own row. Its first assignment applies the channel's pagination rule to page 1's
   **registered** URL. When the page count shrinks, the computed rows above the new count are deleted (overrides kept,
   decision 13). Navigation and `$CMS_REF(page:…)` keep targeting page 1 (M21).
6. **Preview.** `PageRenderService` registers/resolves in `PREVIEW` per locale for every link kind (pages, media,
   folders, navigation) when it renders site-relative links (`!rewriteLinks`); share-token links stay as they are.
   `PREVIEW` rows are computed from `LiveOutputPathResolver` (drafts).
7. **Removal.** An asset that is deleted, unpublished, or whose release is withdrawn for a locale loses its computed
   rows (both areas; that locale only for a withdrawn locale release); overrides stay. Hook points:
   `AssetServiceImpl.softDelete` (as today for page references), the release/unpublish service, and wherever the build drops outputs that are no
   longer in the plan (GENERATED rows only; locate the hook in M32.5).
8. **Rebuild on override/reset.** An override, a reset or an import records a row in `url_registry_change`
   (area, target type and uuid; none for a channel, area or project reset). The next INCREMENTAL build makes every
   asset whose URL changed since its base build a root of kind `RebuildRootKind.URL_CHANGED` — pages and media whose
   planned path differs from the base manifest, folders from the change log (every pages folder after a wide reset) —
   so the asset, its linkers and navigation re-render, and `BuildRedirects` emits the AUTO redirect from the old URL
   (shadowing as in M30). No FULL build is forced. A reset clears the row, so the next build assigns the currently
   computed path and writes the file there. *(Planned as a revision summary entry and an edge kind `URL_REGISTRY`; a
   root kind fits better — nothing links the target to the change — and the registry allocates no revisions.)*
9. **Export/import protocol 11.** A full-project archive gains `url-registry.json` with every `GENERATED` row
   (target type/uuid, channel, locale, variant, page number, url, overridden). Selective exports carry the rows of
   the exported targets. `ImportOptions` gains `UrlRegistryImportMode`: `ARCHIVE_WINS` (default — archive rows replace
   the target's computed rows, the target's overrides are kept and reported as non-blocking conflict entries),
   `TARGET_WINS` (only fills gaps), `REPLACE_ALL` (archive replaces everything incl. overrides). Rows of targets whose
   UUID was re-minted on import follow the `UuidRemapper`; rows of targets not imported are skipped. A URL clash with
   another target is a conflict entry, and the row is skipped. Protocol ≤ 10 archives import without rows.
10. **REST.** `GET /projects/{p}/url-registry` gains filters `targetType`, `locale`, `targetUuid`, `q` (asset name
    or url); `UrlRegistryEntryView` gains `targetType`, `targetUuid`, `targetLabel`, `targetPath`, `variant`,
    `pageNumber`, `locale` (drops `pageReferenceUuid`/`pageReferenceLabel`). Override `PUT` and reset `POST` take a
    target instead of a page reference; reset gains scope `ASSET`. Roles unchanged (read VIEWER, override DEVELOPER,
    reset PROJECT_ADMIN as today). Import request gains `urlRegistryMode`.
11. **UI.** Settings panel renamed "URLs" with filters (type, locale, channel, area, search). A "URLs" section in the
    page, media and folder editors lists the asset's rows (per channel/locale/variant/page) with override and reset.
    The import dialog offers the three `UrlRegistryImportMode`s.
12. **Codes.** `SF-DOM-0200` (409, URL already registered for another target), `SF-DOM-0201` (422, invalid override
    URL). Build collisions reuse `SF-GEN-0110`.

## Exit criteria (epic is done when)

- [x] After a full build every page, paginated page, media file (each variant, each locale) and index-less folder of
      every channel has a GENERATED row; after previewing a page in a language, its links have PREVIEW rows in that
      language.
- [x] `$CMS_REF(page:/media:/folder:)`, navigation hrefs, sitemap, canonical/hreflang and the link checker use the
      registry URL; an override moves the written file and every link to it.
- [x] Moving a page changes no output until its row is reset; after the reset an incremental build moves the file,
      re-renders its linkers and navigation, and emits an AUTO redirect.
- [x] Override collisions are refused (`SF-DOM-0200`); build collisions report `SF-GEN-0110`; deleted/unpublished
      assets lose computed rows and keep overrides.
- [x] Export/import protocol 11 round-trips GENERATED rows with all three import modes; protocol-10 archives import.
- [x] The UI shows the "URLs" panel with filters and per-asset URL sections; the import dialog offers the mode.
- [x] 5,000-page full build within +15 % of pre-M32.
- [x] `./gradlew spotlessCheck build` (`test --rerun`), `ui` `npx ng build` and `npx vitest run` green; spec and guides
      updated.

## Tasks (dependency order)

| # | Task | Area | Depends |
|---|---|---|---|
| 1 | [M32.1 Model and migration](001-model-and-migration.md) | backend | — |
| 2 | [M32.2 Registry service](002-registry-service.md) | backend | M32.1 |
| 3 | [M32.3 Generation: registry-driven outputs and links](003-generation-outputs-and-links.md) | backend | M32.2 |
| 4 | [M32.4 Preview per locale](004-preview.md) | backend | M32.2 |
| 5 | [M32.5 Planner, redirects, removal](005-planner-redirects-removal.md) | backend | M32.3 |
| 6 | [M32.6 Export/import protocol 11](006-export-import.md) | backend | M32.2 |
| 7 | [M32.7 REST API](007-rest-api.md) | backend | M32.2 |
| 8 | [M32.8 UI](008-ui.md) | frontend | M32.6, M32.7 |
| 9 | [M32.9 Spec and docs](009-docs.md) | qa | M32.1–M32.8 |

The epic is small in features, so its tasks sit directly under the epic (one task per feature). After M32.2, M32.3,
M32.4, M32.6 and M32.7 are parallel lanes (`GenerationRenderer`/`RenderPipeline`/post-processors vs
`PageRenderService` vs `ProjectExportImportServiceImpl` vs `UrlRegistryController`). M32.5 needs M32.3's
registry-driven output paths.

## Dependencies

`M8` (URL registry, navigation), `M16` (reference materialization), `M21` (pagination outputs), `M22` (planner edges,
rebuild reasons), `M24` (locales), `M27` (release per locale, `computed` supplier), `M30` (AUTO redirects, link
checks), `M9`/`M11`/`M14` (export/import, `ImportOptions`, `UuidRemapper`).

## Notes

- **API shape.** Regenerate OpenAPI (`./gradlew :server:sf-app:generateOpenApi -Pfrontend.skip=true`) and
  `ui/src/app/core/api/generated/schema.d.ts` (`npm run generate:api`) after each task that changes the API.
- **Performance.** Registering every output adds one lookup per output and per link. Batch-load the project's rows
  per (channel, area, locale) at build start and insert new rows in batches; don't query per link.
- **Not in scope:** registry rows for records, datasets, globals or templates; per-channel media URLs; redirects
  generated from registry overrides other than the AUTO move redirect; changing the pagination rule itself.
