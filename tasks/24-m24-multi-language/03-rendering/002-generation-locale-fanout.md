---
id: M24.3.2
status: done
depends: [M24.3.1, M24.2.2, M16.4.1, M22.1.1]
epic: m24-multi-language
feature: rendering
area: backend
---

# M24.3.2 — Generation fan-out page × channel × locale, `{locale}` paths, URL registry, hreflang

## Context

`PlanEntry(pageUuid, channel, outputPath)` / `BuildPlan(incremental, revision, entries,
changedAssets)` (`sf-generate/.../generate/plan`). `BuildPlanner.plan` adds one entry per
page × channel via `paths.resolvePagePath(page, channel)`; `changedAssets` is asset-level
(`AssetVersionRepository.findAssetIdsChangedSince`). `RenderPipeline.execute` checks
`paths.findCollisions(entries)` (`SF-GEN-0110`) and keeps `dependenciesByPage` as
`Map<UUID, Set<UUID>>` (M21.2.1 re-keys it per entry). `OutputPathExpander`
(`sf-domain/.../channel`) resolves `payload.output.pathOverride.<ch>` → template
`outputPath.<ch>` → `{folder}{uid}.{ext}` and expands `{displayNameSlug} {folder} {uid}
{ext} {channel} {year} {month} {day}` from `PageContext(uid, displayName, folderPath,
payload, templatePayload)`. `UrlRegistryEntry` is unique on `(project_id, channel_key,
page_reference_uuid, area)`. `PreviewTokenService.ShareTarget(kind, pageUuid, revision,
channel, projectKey)`. `SitemapPostProcessor` iterates `SitePage(uid, path, channel,
title)`.

## Goals

- **Plan:** `PlanEntry` gains `locale` (nullable). For a localized project `BuildPlanner`
  emits one entry per page × channel × project locale; non-localized projects emit exactly
  today's entries (`locale = null`). Collision detection keys on `(outputPath)` across all
  locales.
- **Output paths:**
  - `OutputPathExpander.PageContext` gains `locale` + `LocaleConfig`-derived
    `localePrefix`; new placeholder `{locale}` expands to the locale code, or to an empty
    string for the default locale when `defaultWithoutPrefix` is on (collapsing a
    resulting leading/double `/`).
  - Default expression when the project is localized: `{locale}/{folder}{uid}.{ext}`.
  - A template `outputPath` or page `pathOverride` without `{locale}` in a localized project
    yields `SF-GEN-0111` "output path is not locale-distinct" at validate stage (error,
    since it would collide) and a warning diagnostic at template save
    (`TemplateServiceImpl`).
  - `LiveOutputPathResolver` (preview/URL registry) gets the same parameters.
- **Links:** `$CMS_REF(page:…)$`, nav hrefs and `CMS_LOCALES.href` resolve to the target
  in the **render locale** (or the requested locale for `CMS_LOCALES`), relative to the
  current entry's output path (`GenerationRenderer.relativeUrl`, `tasks/lessons.md`).
  `$CMS_REF(page:x, locale="en")$` explicitly targets another locale.
- **URL registry:** `url_registry_entry` gains `locale_key` (varchar, `''` for
  non-localized) in the unique key; `UrlRegistryServiceImpl.resolve/override/reset/search/
  insertIfAbsent` take the locale; Liquibase changeset recreates the unique constraint
  (dbms-paired). Existing rows get `''`.
- **hreflang:** each localized page's render context gets `$CMS_META(alternates)$`-style
  data via `CMS_LOCALES` (M24.3.1) and `SitemapPostProcessor` emits
  `<xhtml:link rel="alternate" hreflang="…">` per locale plus `x-default` → default
  locale. `SitePage` gains `locale`.
- **Incremental — locale-narrowed rebuilds:** for each changed PAGE (and section-hosting
  page) compare the payload at `lastSuccessfulRevision` with the snapshot payload; if only
  L10N `values.<loc>` entries differ, plan that page's entries for those locales only;
  any non-localized change (structure, template, non-localizable value, UID, folder) plans
  all locales. Dependency-driven rebuilds (media, templates, globals) plan all locales.
  Record the narrowing in the M22.1.1 reason chain (`LOCALE_VALUES_CHANGED [en]`).
- **Preview:** `PageRenderService.renderPage(..., locale)`; preview endpoint accepts
  `?locale=`; `ShareTarget` gains `locale` (token claim), default = project default
  locale.
- **Search index post-processor:** `SearchIndexPostProcessor` entries gain `locale`.

## Acceptance criteria

- [x] Integration test (`GenerationIntegrationTest` style): locales `de` (default), `en`;
      pages `about`, `pf/p2`; output `de/about.html`, `en/about.html`, `de/pf/p2.html`,
      `en/pf/p2.html`; with `defaultWithoutPrefix` → `about.html`, `en/about.html`.
- [x] Links: `en/pf/p2.html` links to `../about.html` for `$CMS_REF(page:about)$`; a link
      checker resolving every href against its page finds no broken links
      (`tasks/lessons.md` rule).
- [x] Template `outputPath` without `{locale}` in a localized project → save warning,
      generation `SF-GEN-0111`.
- [x] Sitemap contains `hreflang` alternates + `x-default`.
- [x] Incremental: change only `en` headline → plan contains that page's `en` entries
      only (per channel); change a non-localizable editor → all locales.
- [x] URL registry rows per locale; concurrent insert test (from the URL-registry race
      fix) still passes with the new key.
- [x] **Non-localized regression:** existing generation integration fixtures produce
      identical plan entries, output file set and bytes to master.
- [x] Benchmark: 5,000 pages × 2 channels × 2 locales full build measured and recorded
      against §18.6 (target restated per plan entry); no regression for the non-localized
      benchmark.
- [x] `./gradlew build` green.

## Out of scope

- Globals/datasets/pagination/search internals (M24.3.3).
- Localized path segments / slugs per locale.
- Automatic browser-language redirects at the site root (server config, not generation).

## Notes / hazards

- **Plan size × locales:** entries multiply by locale count; memory in `RenderPipeline`
  (per-entry dependency sets, rendered bytes buffered before write) must stay bounded —
  measure heap on the 5,000 × 2 × 2 fixture.
- **UID/URL uniqueness:** UIDs stay per `(project, asset_type)`; uniqueness per locale is
  purely the `{locale}` segment — hence the hard `SF-GEN-0111` instead of silently
  overwriting one locale with another.
- `OutputPathResolver.forSnapshot(snapshot, "index", false, "DEFAULT")` hardcoding is
  removed by `M16.4.1`; do not reintroduce it when adding the locale parameter.
- Asset copy (`AssetCopyStage`) stays locale-independent — media are written once.

## Implementation notes (2026-09-17)

- `PlanEntry` gained `locale` (null without locales); `BuildPlanner` fans out page × channel ×
  language. A project without locales takes the **original** 2-arg resolver calls, so its plan is
  produced by unchanged code rather than by a language-aware path that happens to agree.
- `{locale}` lives in `OutputPathExpander`; the default expression becomes
  `{locale}/{folder}{uid}.{ext}` once a project has languages, and "default language without
  prefix" collapses the empty segment's slashes back to the pre-M24 path.
- `SF-GEN-0111` is checked in `RenderPipeline.execute` before anything renders.
- URL registry: new `locale_key` column in the unique key (changelog `018`), `''` for a project
  without locales so no pre-M24 row changes identity.
- `BuildManifest.Output` and `CarryForward`'s output key gained the language. **Defect found while
  testing:** without it, an incremental run of a localized project carried forward only one
  language's file per page and silently dropped the others.
- Sitemap emits `xhtml:link rel="alternate"` per language plus `x-default`.
- Incremental narrowing: `LocaleValueDiff` decides whether a page's change was confined to
  translations; only then are that page's other languages left out, and `RebuildReason` records
  `changedLocales`. Anything structural still rebuilds every language.
- Preview and share links carry `?locale=`/a `locale` token claim.
- Covered by `LocalizedGenerationIntegrationTest` (6 cases), including a link check that resolves
  every generated href against its own page.
