---
id: M27.3.1
status: done
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

- **Changes candidates.** `AssetVersionRepository.findChangeCandidates` (M27.1.3) expects one pointer for every media
  asset (`CASE WHEN a.assetType = MEDIA THEN 1 ELSE :keys END`), so a localized media asset whose pointers all sit at
  its draft except one missing locale would never become a candidate. Count a localized media asset's keys like a
  page's (the project's locale count), e.g. by reading the flag in the query or by passing both counts; keep the query
  a single statement.

## Acceptance criteria

- [x] Localize → upload an EN file → EN resolves to it, `de-CH` falls back to `de`, a locale without own file falls back
      to the default file.
- [x] Un-localize with other files → `409 SF-MEDIA-0505` listing them; with `confirmDiscard` → one revision, pointers
      collapsed, default file kept.
- [x] Status: replacing only the EN file makes only EN `CHANGED`.
- [x] Upload pipeline rules apply to locale files (MIME sniffing, SVG sanitizing, size cap) — tests reuse the
      existing upload test fixtures.
- [x] Changes list: a localized media asset released in DE only lists EN as `NEW`; one released in every locale
      at its draft is not a candidate; non-localized media still counts one key.
- [x] Existing media endpoints and payload readers unchanged for non-localized media (regression suite green).
- [x] `./gradlew build` green.

## Out of scope

- Output paths, reference resolution, release/ASSETS stage, preview serving (`M27.3.2`); UI (`M27.6.4`); export
  (`M27.5.1`).

## Notes / hazards

- Keep the default locale's file at the top level of the payload: every existing reader (variants, image metadata,
  search indexing, impact) stays correct without changes; only locale-aware readers use `MediaFiles.fileFor`.
- Removing a locale from the project: its own files stay in the payload (harmless, invisible) until the media is
  saved again — note it in the docs task rather than migrating payloads.

## Implementation notes

- **Payload** (`asset/media/MediaFiles`, the one helper every locale-aware reader uses): `localized`, `fileLocale` (the
  locale the top-level file belongs to — recorded when localizing, so changing the project's default locale later
  doesn't hand the German file to English) and `localeFiles`. `fileFor(payload, locale, chain)` walks the chain;
  the top-level file is the last resort. `effective(payload, locale, chain)` gives the payload with the top-level file
  fields replaced by the locale's file — what binary serving, text reads and (M27.3.2) generation read.
- **Pipeline.** `MediaServiceImpl` now has `prepare` (size cap, Tika sniffing, allow-list, dimensions, EXIF strip /
  SVG sanitizing) and `store` (blob + `ref_count`, variants) shared by upload, replace and the per-locale upload.
  `replace` copies the payload and swaps the file fields instead of rebuilding it from plain strings — which also
  fixes a pre-existing loss of localized alt text/caption on replace in a project with locales.
- **API.** `PUT /media/{uuid}/localized` (`If-Match`, `{localized, confirmDiscard}`), `POST|DELETE
  /media/{uuid}/files/{locale}`, `?locale=` on `GET/PUT /text`, `PUT /process`, `GET /binary`, `GET /thumbnail` and
  the rendered binary. A locale that falls back gets its own file on a text write (copy of what it rendered) or a
  `processCms` change applies to the file it renders. Removing a file a locale doesn't own writes nothing; the default
  file can't be removed (`422 SF-MEDIA-0509`). Problems `SF-MEDIA-0505`–`0509` (`MediaProblems`).
- **Toggle pointers** (`ReleaseCarryForward.rekeyMedia`, one revision with the toggle): each new pointer moves to the
  toggled version when the pointer it replaces was published (like a system migration), else keeps its released
  version — so every locale keeps the status the shared/default pointer had. An `UNPUBLISHED` shared pointer leaves the
  per-locale keys `NEW` (there is no history for them).
- **Projection.** A localized media payload projects, per locale, the resolved file plus its owner locale (and drops the
  MIME column, which describes only the default file); a locale that starts to own a file is `CHANGED` even with the
  same bytes, because it publishes at another path. Discarding one locale also restores its own file
  (`MediaFiles.restoreOwnFile`).
- **Changes candidates:** a media asset counts every locale key when one of its open pointers at the draft is
  per-locale (the flag lives in the JSON payload); a localized draft without pointers at it is a candidate anyway.
- **Pre-existing bug fixed:** every media write other than upload/replace (metadata, process flag, text, restore,
  folder move, the M24 localizable migration) wrote a version without `mime_type`/`size_bytes`, so the media library's
  MIME filter (`?mimeType=image/*`, the image pickers) stopped finding the file. The columns are now projected from the
  payload wherever a version is written (`AssetVersion.projectMediaColumns`); `setMediaColumns` is gone.
- **Not done here:** export of locale files (`M27.5.1`), UI (`M27.6.4`). Removing a locale from the project leaves its
  file in the payload (invisible, refused by the API) until the media is un-localized or the file is replaced.
- **Tests:** `LocalizedMediaIntegrationTest` (11: chain resolution and DTO over HTTP, un-localize 409/confirm with
  pointer collapse, localize keeps statuses, per-locale status + discard + remove, upload rules (sniffing, SVG, size
  cap, roles), refusals `0506`–`0509`, text/process per locale, Changes candidates, MIME column regression, blob
  refs, removed locale).
