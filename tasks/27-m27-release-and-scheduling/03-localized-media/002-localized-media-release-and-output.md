---
id: M27.3.2
status: done
depends: [M27.3.1, M27.2.1]
epic: m27-release-and-scheduling
feature: localized-media
area: backend
---

# M27.3.2 — Localized media in generation and preview: per-locale paths, references, release

## Context

`asset/media/MediaPaths.java` (`mediaPath` → `assets/media/{uid}.{ext}`, `variantPath`), ASSETS stage in
`sf-generate` (media copy, content-addressed skip, processed text media rendering), `render/GenerationRenderer`
(`urlResolver` `:431`, media `:466`), `OctlRenderer.renderRef` (`MEDIA`/`MEDIA_REF`), locale path prefixes of pages
(M24 `{locale}` placeholder, "default locale without prefix"), `BuildManifest` (outputs with locale),
`PreviewController` media share URLs, `M27.2.1` (released snapshot per locale), `M27.3.1` (`MediaFiles.fileFor`).
Epic decisions 16–18.

## Goals

- **Paths.** `MediaPaths.localizedMediaPath(localePrefix, uid, ext)` → `{localePrefix}assets/media/{uid}.{ext}` (and
  variants), where `localePrefix` is exactly the prefix that locale's pages get (empty for the default locale with
  "default locale without prefix"). Non-localized media keep `assets/media/{uid}.{ext}`.
- **Written per locale with an own file.** For a localized media released in locale L: if L has its **own** file (in
  the released version), write it at L's prefixed path; if L falls back, write nothing for L — references in L resolve
  to the path of the locale it falls back to. The manifest records the locale of each media output.
- **References.** `$CMS_REF(media:…)`, `media` editor values and processed text media resolve, for render locale L,
  to the released version for L → `MediaFiles.fileFor(L)` → the path of the locale that owns that file. Relative URLs
  from the rendering page as today (lessons: links relative to the current page).
- **Release per locale.** Pointers per locale for localized media (from `M27.1.1`); a media unreleased in L renders
  empty with `SF-GEN-0221` in L's pages only.
- **Incremental.** Replacing and releasing only the EN file plans only EN outputs that reference it plus the EN copy.
- **Preview** serves the right locale file (draft or published view) through the media share URL, carrying the locale.
- **Search-index/sitemap** unaffected (media are not site pages).

## Acceptance criteria

- [x] Golden: a project with locales `de` (default, no prefix) and `en`: a localized media with its own EN file is
      written at `assets/media/x.png` and `en/assets/media/x.png`; an EN page links `../assets/media/x.png`-style
      relative URLs to the EN file; a `fr` page (falls back to `de`) links the DE file and no FR copy exists.
- [x] Non-localized media output unchanged (existing golden tests).
- [x] Unreleased in EN only → EN pages render the reference empty with `SF-GEN-0221`, DE pages render it.
- [x] Incremental: EN file released → only EN referencing pages + EN copy planned (reason chain shows the media).
- [x] Preview draft/published shows the locale's file.
- [x] `./gradlew build` green.

## Out of scope

- UI (`M27.6.4`).

## Notes / hazards

- Path collisions: a page could own `en/assets/media/…` — the existing collision check (`SF-GEN-0110`) must include
  locale media outputs.
- Variants follow the file: a locale file has its own variants; `variantPath` gets the same prefix.

## Implementation notes

- **One rule** (`generate/render/MediaOutputs`): a reference to media from locale L resolves in L's view. Media that
  isn't localized has its one output. A localized file L owns is written under L's prefix
  (`MediaPaths.localePrefix`, the `{locale}` segment of L's pages); a file L falls back to links the owner's output
  when the owner publishes its own file there (released in the owner's locale and owning its file) — what the owner
  publishes is what every locale falling back to it shows. Otherwise (owner not released, or no own file any more) L
  writes the file it renders under its own prefix, so no link points at a file nobody wrote. An output is
  `(media, locale it is written for)` and its content comes from that locale's view.
- **Consumers:** the renderer's URL resolver (pages and processed media), the ASSETS stage (`AssetCopyStage` copies
  what the rendered pages reference *from their locale*, plus the base build's outputs of processed media an
  incremental plan re-renders), carry-forward (base media outputs are kept per output key, found through the kept
  pages' and files' references in their locale), and `$CMS_VALUE(media:x.width)`-style values (the locale's file, in
  generation and preview). Processed text media renders with the renderer of the locale it is written for.
- **Manifest:** media outputs record the locale they are written for (`null` for media that isn't localized, as before).
- **Incremental:** a localized media root is also seeded in every locale whose released version falls back to a locale
  whose pointer changed (`RebuildExpansion.seedFallbackMedia`), since both what and where that locale links depend on
  the owner's release. Releasing only the English file plans only English pages; releasing the German file plans German
  and French (fallback) pages.
- **Collisions:** after the ASSETS stage, page outputs are checked against media output paths (`SF-GEN-0110`, now for
  every media output, not only localized ones).
- **Compile memos:** the per-build text media memo and the preview's cross-request cache were keyed by media (and
  version) only; a localized stylesheet has one source per locale, so they are keyed by the source / blob now.
- **Preview:** share tokens already carry the locale; the share route, the rendered-binary route (`?locale=`) and
  processed media rendering serve the locale's file, in the draft or published view.
- **Edge:** a media between a shared and a per-locale release state whose default locale has no prefix can map two
  outputs to one path; the first requested keeps it.
- **Plan insight / impact** list a processed media file once per output, with its path and locale
  (`MediaOutputs.outputsOf`); `PlanInsight.entries` takes the `PlannedBuild` for the project's locales.
- **Links:** an English page links its own copy as `assets/media/x.png` (relative from `en/home.html` to
  `en/assets/media/x.png`); the `../assets/media/…` form of the acceptance text is what a French page (falling back
  to the root German file) gets.
- **Tests:** `LocalizedMediaGenerationIntegrationTest` (8: golden paths and relative links for de/en/fr with the
  manifest locale, variants per locale, unreleased in one locale with `SF-GEN-0221`, fallback copy when the owner
  isn't released, incremental plans and carried outputs per locale, a processed stylesheet per locale with its plan
  rows, collision, preview draft/published per locale).
