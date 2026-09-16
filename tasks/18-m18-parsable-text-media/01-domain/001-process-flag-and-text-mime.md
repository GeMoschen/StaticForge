---
id: M18.1.1
status: done
depends: []
epic: m18-parsable-text-media
feature: domain
area: backend
---

# M18.1.1 — `processCms` media flag + text MIME allow-list + extension mapping

## Context

The media payload built by `MediaServiceImpl.buildPayload` holds `blobSha256, fileName,
mimeType, sizeBytes, image{…}, altText, caption, copyright, focalPoint, variants[]`. It has no
processing flag. `MediaServiceImpl.updateMetadata(uuid, altText, caption, copyright,
focalPoint, expectedRevision, ctx)` is the only non-binary edit path. `replace(...)` rebuilds
the payload from scratch and copies only the four metadata fields over.
`MediaPaths.extensionFor(mime)` (`sf-generate/.../generate/pipeline/MediaPaths.java`) maps
`text/css`, `application/javascript`/`text/javascript`, `text/plain` and `image/svg+xml`.
`application/json` and XML types fall through to `bin`.

## Goals

- Define the **text MIME allow-list** once, as a domain constant, e.g. a `TextMediaTypes`
  helper in `asset.media`: `text/css`, `application/javascript`, `text/javascript`,
  `application/json`, `image/svg+xml`, `text/plain`, `application/xml`, `text/xml`. Put it
  where both `sf-domain` and `sf-generate` can reach it (`sf-domain`, since `sf-generate`
  already depends on it). It is the single source of truth for "can be processed", "can be
  edited as text" and the UI's toggle visibility (exposed on the media view).
- Add `processCms` (boolean, default `false`, absent = `false`) to the media payload:
  - `buildPayload` writes it.
  - `replace` carries the previous value over, but **clears it** when the replacement's
    sniffed MIME type is no longer in the allow-list, and returns that fact in the response so
    the UI can tell the user.
  - A new service operation `setProcessCms(uuid, boolean, expectedRevision, ctx)` (or an
    extension of `updateMetadata`, whichever keeps `MediaController`'s request DTO cleanest)
    rejects non-text MIME types with 400 `ProblemFactory.badRequest` and creates exactly one
    revision.
- Extend `MediaPaths.extensionFor`: `application/json` → `json`, `application/xml`/`text/xml`
  → `xml`. Keep every existing mapping unchanged.
- Expose `processCms` and a derived `textEditable` on the media DTO returned by
  `MediaController`, then regenerate the OpenAPI `schema.d.ts`.

## Acceptance criteria

- [x] Toggling `processCms` on a CSS media file stores `payload.processCms=true` and creates
      one revision. The revision diff shows the single field change.
- [x] Toggling it on a PNG/PDF returns 400 and creates no revision.
- [x] `replace` of a processed CSS with another CSS keeps the flag. `replace` with a PNG
      clears it and the response says so.
- [x] Export → import round-trip keeps `processCms` (verify in
      `ProjectExportImportIntegrationTest`, or a new focused test).
- [x] Restoring an older media revision restores the older flag value.
- [x] `MediaPaths.extensionFor("application/json")` is `json`, the XML types are `xml`, and
      every previously mapped type is unchanged (unit test).
- [x] Tika sniffing is checked with real sample files (`.css`, `.js`, `.json`, `.svg`,
      `.txt`, `.xml`, plus a minified `.js`), and the allow-list covers what Tika actually
      returns. Any mismatch is fixed or documented in the test.
- [x] `./gradlew :server:sf-domain:test :server:sf-generate:test :server:sf-api:test` is green.

## Out of scope

- Editing the text content (`M18.1.2`).
- OCTL validation when the flag is switched on (`M18.2.1`).
- Any generation or preview behaviour (`M18.3.*`).

## Notes / hazards

- The `effectiveAllowedMime` upload allow-list (`Project.allowedMimeTypes`/`sf.media.allowed-mime`)
  decides what may be **uploaded**. The new text allow-list decides what may be **processed**.
  They are independent: a project can forbid JS uploads altogether.
- If an existing payload has no `processCms` key it must read as `false`. Don't write a
  Liquibase data migration for this.
- Keep the flag in the payload (ADR-0003), not as a new `asset_version` column. Nothing needs
  to query it.

## Implementation notes (2026-09-16)

- `asset.media.TextMediaTypes` holds the allow-list plus `isText`, `isScriptLike` (JS/JSON) and `isProcessed`
  (flag on *and* text type). `MediaView` and `MediaSummaryView` expose `processCms` and `textEditable`.
- **Tika, checked with real samples** (`TextMediaTypesTest`, `src/test/resources/text-media/`): detection is
  name-driven. `.css`, `.js` (also minified), `.json`, `.svg`, `.txt`, `.xml` map as listed. Two findings:
  `.webmanifest` is `application/manifest+json`, which was **added** to the allow-list (a manifest is the epic's
  own example) and maps to `webmanifest`; `.mjs` is `text/plain` and is published as `.txt` (documented in the
  test and the developer guide, not fixed).
- `MediaPaths` moved from `sf-generate` to `sf-domain` (`asset.media`) so preview computes the same media path
  for `$CMS_META(path)$`. Its test pins every previous mapping.
- `PUT /media/{uuid}/process` (`MediaProcessRequest`) → `MediaSaveResponse {media, warnings, processCmsCleared}`;
  `replace` answers with the same shape. Setting the value the flag already has writes no revision (a stale
  `If-Match` still 409s through the new `AssetService.requireRevision`).
- Tests: `ProcessedMediaIntegrationTest` (flag, PNG 400, replace keeps/clears, restore, export/import incl.
  edges), `MediaTextApiTest` (HTTP shapes), `MediaPathsTest`, `TextMediaTypesTest`.
