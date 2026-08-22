---
id: M3.5.1
status: done
depends: [M1.5.1]
epic: m3-editing-ui
feature: media
area: backend
---

# M3.5.1 — Media backend: blob store & upload flow

## Context

Implement §11.2/§11.4: content-addressed bytes, sniffing, EXIF strip, variant generation.

## Goals

- Implement `BlobStore` interface with `FilesystemBlobStore` (default) + `S3BlobStore`
  (optional); path `{root}/{sha[0:2]}/{sha[2:4]}/{sha}`.
- `blob` table (sha256 PK, size, mime, storage_key, ref_count) with `ref_count` + sweep
  rules (§11.2).
- Upload flow (§11.4): stream to temp, SHA-256, Tika MIME sniff (never trust client),
  allow-list + size cap (100 MB) + max dimension 12,000, EXIF GPS strip
  (`sf.media.strip-exif`), metadata-extractor image dims/orientation.
- Variant generation per project **variant policy** (YAML, §11.4) → async webp variants.

## Acceptance criteria

- [ ] Re-uploading identical bytes dedupes by SHA-256 (no new blob).
- [ ] Client-supplied MIME is ignored; Tika result is authoritative.
- [ ] Variants `w400`/`w1600` webp are produced per policy.

## Out of scope

- REST endpoints (next task).

## Notes / hazards

- Write bytes before commit (§21.4); orphaned blobs swept nightly.
- SVG sanitization (script/foreignObject/event attrs) per §11.5.
