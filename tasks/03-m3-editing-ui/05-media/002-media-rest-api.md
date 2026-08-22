---
id: M3.5.2
status: done
depends: [M3.5.1]
epic: m3-editing-ui
feature: media
area: backend
---

# M3.5.2 — Media REST API

## Context

Expose the §20.2 media endpoints with the §11.5 safety posture.

## Goals

- Implement `POST /media` (multipart) + `POST /media/bulk`, `PUT /media/{uuid}/metadata`
  (alt/caption/focal point), `POST /media/{uuid}/replace` (new binary, same identity),
  `GET /media/{uuid}/binary` (`?variant=`), `GET /media/{uuid}/thumbnail` (320px, cached,
  `Cache-Control: private, max-age=86400`), list with `?mimeType/?folder/?q`.
- Serve from a separate path; `Content-Disposition: attachment` for non-renderable types;
  strict CSP for previews (§11.5).
- Enforce usage checks before hard delete (§11.5, `SF-DOM-0120`).

## Acceptance criteria

- [ ] Upload returns the §11.3 media payload (`image`, `variants`, `focalPoint`).
- [ ] `replace` keeps the asset UUID while swapping blob, in one revision.
- [ ] Thumbnails are cached; binaries enforce content disposition per type.

## Out of scope

- Generation asset-copy (M4).

## Notes / hazards

- Never trust client MIME/extension (§11.4).
