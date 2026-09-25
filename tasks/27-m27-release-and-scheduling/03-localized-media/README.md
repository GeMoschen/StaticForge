# Feature: Localized media — one file per locale, released per locale

**Spec:** Extends §11 (media payload, upload, output paths), §16.4 (`$CMS_REF(media:…)`), §18.2 (ASSETS stage), M24
(locales, fallback chains).

## Goal

A media asset flagged `localized` can hold a different file per locale (a DE and an EN screenshot), falls back along
the locale chain, is released per locale and is written at each locale's prefix. Non-localized media behaves as today.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-localized-media-model-and-api.md](001-localized-media-model-and-api.md) | `M27.1.1` |
| 2 | [002-localized-media-release-and-output.md](002-localized-media-release-and-output.md) | 1, `M27.2.1` |

## Feature exit criteria

- [x] Media can be localized and un-localized in one revision (with confirmation when files would be discarded).
- [x] Per-locale files upload/replace; variants per locale file; fallback along the chain.
- [x] Per-locale release pointers for localized media; `""` for non-localized.
- [x] Generation writes localized media per locale with its own file at the locale prefix; references pick the render
      locale's file; preview likewise.
- [x] `./gradlew build` green.

## Dependencies

`M27.1.1` (pointers, locale keys, projection), `M27.2.1` (released snapshot, ASSETS stage), `M24` (`ProjectLocales`,
localized `altText`/`caption`), `M18` (text media — `processCms` stays per file), `M11` upload pipeline
(`MediaServiceImpl`, Tika sniffing, SVG sanitizing, EXIF strip, variants).
