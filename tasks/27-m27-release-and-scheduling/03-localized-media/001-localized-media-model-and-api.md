---
id: M27.3.1
status: todo
depends: [M27.1.1]
epic: m27-release-and-scheduling
feature: localized-media
area: backend
---

# M27.3.1 — Localized media: flag, per-locale files, toggle, upload/replace API

## Context

`asset/media/MediaServiceImpl.java` (`storeBlob` `:632`, `generateVariants` `:495-522`, replace, text write),
`MediaService`, media payload (§11.3: `blobSha256`, `fileName`, `mimeType`, `image`, `variants`, `altText`/`caption`
as L10N since M24, `processCms`), `MediaVersionRepository`, `sf-api/.../api/MediaController.java`, `ProjectLocales`,
`M27.1.1` (`ReleaseLocales`, `LocaleProjection`, pointers). Changelog `v1.0/021-localized-media.xml` (only if a column
is needed — prefer payload). Epic decisions 4, 18, 19.

## Goals

- **Payload.** `localized: boolean` (absent = `false`). A localized media payload holds the default locale's file in the
  existing top-level fields (so every existing reader keeps working for the default locale) plus
  `localeFiles: {[locale]: {blobSha256, fileName, mimeType, sizeBytes, image, variants, processCms}}` for the other
  locales that have their own file. `MediaFiles.fileFor(payload, locale, chain)` resolves a locale's file along the
  fallback chain (the single helper every reader uses).
- **Upload/replace per locale.** `POST /media/{uuid}/files/{locale}` (multipart, `EDITOR` — the role of today's
  `POST /media/{uuid}/replace`, `MediaController:177`) stores/replaces that locale's file with the full upload pipeline (Tika, allow-list, size cap, SVG sanitize,
  EXIF strip, variants per the project policy); `DELETE /media/{uuid}/files/{locale}` removes a non-default locale's
  own file (it falls back again). One revision each. Refused on non-localized media (`422 SF-MEDIA-0506`) and for a
  locale not configured in the project (`422 SF-MEDIA-0507`). The default locale's file is replaced with the existing
  replace endpoint.
- **Text media.** `GET/PUT /media/{uuid}/text` gain `?locale=` for localized text media (default = default locale);
  `processCms` stays per file.
- **Toggle.** `PUT /media/{uuid}/localized` `{localized, confirmDiscard?}` (`EDITOR`) — one revision:
  - `false → true`: the file becomes the default locale's file; release pointer `""` is replaced by one pointer per
    locale at the same version (each `PUBLISHED` iff the `""` pointer was).
  - `true → false`: keeps the default locale's file; if other locale files exist and `confirmDiscard` isn't `true`,
    `409 SF-MEDIA-0505` with `files: [{locale, fileName, sizeBytes}]`; on confirm they are dropped and the per-locale
    pointers collapse to `""` carrying the default locale's pointer (decision 19).
  - Refused in a project without locales (`422 SF-MEDIA-0508`).
- **Blob refs.** Every new locale blob increments `ref_count` like `storeBlob` does today (the M29 sweep relies on
  payload reachability, but keep the counter consistent).
- **DTO.** Media views expose `localized`, `localeFiles` (locale → file summary, `own: true|false` after fallback) and,
  per locale, the resolved file for display.
- **Projection.** `LocaleProjection` for localized media includes the resolved file sha of that locale; editing only
  the FR file changes only FR's status.
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [ ] Localize → upload an EN file → EN resolves to it, `de-CH` falls back to `de`, a locale without own file falls back
      to the default file.
- [ ] Un-localize with other files → `409 SF-MEDIA-0505` listing them; with `confirmDiscard` → one revision, pointers
      collapsed, default file kept.
- [ ] Status: replacing only the EN file makes only EN `CHANGED`.
- [ ] Upload pipeline rules apply to locale files (MIME sniffing, SVG sanitizing, size cap) — tests reuse the
      existing upload test fixtures.
- [ ] Existing media endpoints and payload readers unchanged for non-localized media (regression suite green).
- [ ] `./gradlew build` green.

## Out of scope

- Output paths, reference resolution, release/ASSETS stage, preview serving (`M27.3.2`); UI (`M27.6.4`); export
  (`M27.5.1`).

## Notes / hazards

- Keep the default locale's file at the top level of the payload: every existing reader (variants, image metadata,
  search indexing, impact) stays correct without changes; only locale-aware readers use `MediaFiles.fileFor`.
- Removing a locale from the project: its own files stay in the payload (harmless, invisible) until the media is
  saved again — note it in the docs task rather than migrating payloads.
