---
id: M27.3.2
status: todo
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

- [ ] Golden: a project with locales `de` (default, no prefix) and `en`: a localized media with its own EN file is
      written at `assets/media/x.png` and `en/assets/media/x.png`; an EN page links `../assets/media/x.png`-style
      relative URLs to the EN file; a `fr` page (falls back to `de`) links the DE file and no FR copy exists.
- [ ] Non-localized media output unchanged (existing golden tests).
- [ ] Unreleased in EN only → EN pages render the reference empty with `SF-GEN-0221`, DE pages render it.
- [ ] Incremental: EN file released → only EN referencing pages + EN copy planned (reason chain shows the media).
- [ ] Preview draft/published shows the locale's file.
- [ ] `./gradlew build` green.

## Out of scope

- UI (`M27.6.4`).

## Notes / hazards

- Path collisions: a page could own `en/assets/media/…` — the existing collision check (`SF-GEN-0110`) must include
  locale media outputs.
- Variants follow the file: a locale file has its own variants; `variantPath` gets the same prefix.
