# Feature: Domain — `processCms` flag and text content editing

**Spec:** Extends §11.3 (media payload), §11.4 (upload flow) and §11.5 (constraints), plus
§20.2 (media endpoints).

## Goal

Give MEDIA assets two new capabilities, both restricted to text MIME types:

1. A persisted `processCms` boolean in the media payload, which survives `replace`,
   `updateMetadata`, export/import and restore.
2. Reading and writing the file's text content through the API. Each write stores a new
   content-addressed blob and goes through `assetService.update`, so it creates exactly one
   revision.

This feature doesn't compile or render anything. OCTL validation is feature 2 and
rendering is feature 3.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-process-flag-and-text-mime.md](001-process-flag-and-text-mime.md) | — |
| 2 | [002-text-content-editing.md](002-text-content-editing.md) | 1 |

## Feature exit criteria

- [x] `processCms` is stored in the media payload, can be toggled through the API for text
      MIME types only, and survives replace, metadata update, export/import and restore.
- [x] `MediaPaths.extensionFor` maps every allow-listed text MIME type to the right extension
      (no `bin` fallback for JSON/XML).
- [x] `GET`/`PUT /media/{uuid}/text` read and write UTF-8 text content with `If-Match`
      concurrency. A write creates one revision and one new blob, and SVG writes go through
      `SvgSanitizer`.

## Dependencies

`M1:revision` (`RevisionContext`, `If-Match`), the existing media stack (`MediaServiceImpl`,
`MediaController`, `BlobStore`, `SvgSanitizer`, `MediaPaths`), and `M10`–`M14` export/import
(payload-generic, but its round-trip is verified here).
