---
id: M18.1.2
status: todo
depends: [M18.1.1]
epic: m18-parsable-text-media
feature: domain
area: backend
---

# M18.1.2 — Text content read/write for text media

## Context

Media bytes can today only be changed by uploading a whole new file through `POST
/media/{uuid}/replace` (`MediaServiceImpl.replace`). Reading the bytes goes through `GET
/media/{uuid}/binary` (`MediaServiceImpl.binary`). An author working on a processed CSS file
would have to download, edit locally and re-upload for every change. The user decided that
processed text media gets **in-app text editing, where each save creates a revision**.

## Goals

- `MediaService.readText(projectId, uuid, revision?)`: returns the blob content as UTF-8
  text plus the version's `validFromRevision` (for `If-Match`). Rejects non-text MIME types
  with 400.
- `MediaService.writeText(uuid, String text, long expectedRevision, RevisionContext ctx)`:
  - Enforces the same size limit as uploads (`checkSize`) on the UTF-8 bytes.
  - Keeps the MIME type fixed. The file type can't change through a text edit, and
    `fileName` stays the same.
  - Runs `SvgSanitizer` for `image/svg+xml`, with the same rule as `strip()` on upload.
  - Computes the SHA-256, calls `storeBlob`, then `assetService.update(...)` with a payload
    that differs from the old one only in `blobSha256`/`sizeBytes`. `processCms`, metadata
    and `fileName` stay as they are.
  - Calls `setMediaColumns` so `size_bytes` stays in sync.
  - Revision conflicts surface as the standard 409 (spec §7.5).
- REST in `MediaController`:
  - `GET /api/v1/projects/{key}/media/{uuid}/text` (VIEWER) returns
    `{text, mimeType, revision}` plus an `ETag`.
  - `PUT /api/v1/projects/{key}/media/{uuid}/text` (EDITOR, `If-Match` required) returns the
    updated media view.
  - Regenerate the OpenAPI schema.
- Blob refCounts behave exactly as they do for `replace`. Do not delete the previous blob:
  older revisions still point at it.

## Acceptance criteria

- [ ] `GET …/text` of a CSS file returns its exact content. For a PNG it returns 400.
- [ ] `PUT …/text` with the correct `If-Match` creates exactly one revision. The new version
      has a new `blobSha256`, updated `sizeBytes`, and an unchanged `processCms`/`altText`/
      `fileName`. The old blob is still readable via `binary(…)` at the old revision.
- [ ] `PUT …/text` with a stale `If-Match` returns 409 and changes nothing.
- [ ] A text write containing `<script>` in an SVG is stored sanitized, matching upload behaviour.
- [ ] Writing text larger than the configured media size limit returns the same error as an
      oversized upload.
- [ ] Non-UTF-8 source files (e.g. a Latin-1 `.txt` uploaded earlier) are handled on read
      without crashing: decode with replacement, and include a flag in the response telling
      the UI the file isn't clean UTF-8.
- [ ] Time-travel read-only backstop (`M15.5`) covers the new `PUT` without extra UI work
      (it's a mutating request).
- [ ] `./gradlew :server:sf-domain:test :server:sf-api:test` is green, with new integration
      tests for both endpoints.

## Out of scope

- OCTL compile/validation on write (`M18.2.1` adds it to this write path).
- Editing binary files, changing a file's MIME type through a text edit, or creating a new
  text media file from scratch in the UI. New files are still uploaded. An "empty CSS file"
  creation shortcut can be a follow-up.

## Notes / hazards

- Line endings: store exactly what the client sends. Normalizing CRLF/LF would create
  spurious diffs and SHA changes. The UI editor must not rewrite line endings either.
- A byte-order mark (BOM) at the start of an uploaded file must survive a read/write round-trip
  without being duplicated.
- Content-addressing means a no-op save (identical text) produces the same SHA. Decide whether
  that still creates a revision. Recommendation: return the current version unchanged with no
  revision, consistent with how a no-change metadata save behaves today (check
  `AssetServiceImpl.update` for existing no-op handling before choosing).
