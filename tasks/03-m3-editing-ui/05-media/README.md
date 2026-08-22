# Feature: Media (backend + library)

**Spec:** §11 (media type), §20.2 (media endpoints), §24.5 (#5 media library).
**Area:** backend + frontend. **Epic:** M3.

## Goal

Implement the content-addressed blob store and upload flow (sniffing, EXIF strip,
variants) plus the media library UI with usages/replace.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-media-backend-blobstore.md](001-media-backend-blobstore.md) | M1.5.1 |
| 2 | [002-media-rest-api.md](002-media-rest-api.md) | 1 |
| 3 | [003-media-library-ui.md](003-media-library-ui.md) | M3.3.3, 1 |

## Feature exit criteria

- [ ] Upload computes SHA-256 + Tika type sniff; variants generated per project policy.
- [ ] Media referenced by a non-deleted asset can't be hard-deleted without confirmation.
- [ ] Library grid with focal-point-aware thumbnails + drop-zone + usages drawer.

## Dependencies

`M1:asset-api` (generic asset/version), `M3:form-engine` (media/reference editors).
