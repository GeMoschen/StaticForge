---
id: M29.2.3
status: todo
depends: [M29.1.1, M27.3.1]
epic: m29-housekeeping-jobs
feature: core-jobs
area: backend
---

# M29.2.3 — Blob sweep (mark and sweep)

## Context

- `Blob` (`sf-domain/.../asset/media/Blob.java`, `ref_count` only incremented) and `BlobRepository`.
- `BlobStore` (`FilesystemBlobStore` with layout `{root}/{sha[0:2]}/{sha[2:4]}/{sha}`; `S3BlobStore`).
- `MediaServiceImpl.storeBlob` (`:632-641`) and `ProjectExportImportServiceImpl.importBlob`.
- Media payload keys `blobSha256` and `variants[].blobSha256`, plus M27 localized-media files (M27 feature 3; use the
  key it defines).
- `media_variant` (`M29.3.2`, if already merged; otherwise add its mark when that task lands).
- `generation_run.log_blob_sha`.
- Epic decision 8, spec §11.2 and §26.5.

## Goals

- **Mark.** Stream every `asset_version` row whose payload may carry blob references: every row of every revision,
  deleted versions included, in pages of `(id)`. Collect the referenced hashes.
  - Do the extraction in SQL with JSON path functions where both H2 and PostgreSQL support them. Otherwise stream the
    payloads of `MEDIA` versions, the only type that references blobs today, and assert that in a test so a new
    referencing type fails loudly.
  - Add `media_variant.blob_sha`, `media_variant.source_sha` and non-null `generation_run.log_blob_sha`.
- **Sweep rows.** `blob` rows not marked, with `created_at` older than `graceHours` (default 24):
  - re-check "still unmarked and old" per hash right before deleting, in a short transaction;
  - delete the store object first, then the row, so a crash leaves at most an orphan object that the next sweep finds.
- **Sweep store objects.** List the store (the filesystem walk, or S3 `ListObjectsV2` with the prefix) and delete
  objects that have no `blob` row and are older than the grace period. These are orphan bytes from failed commits and
  imports.
- **`ref_count`.** Recompute it for every surviving row as the number of referencing version rows (batch `UPDATE`).
  Document in `Blob` Javadoc and spec §11.2 that it is derived and informational. Remove the "nightly sweep is out of
  scope" notes.
- **Job `blob-sweep`** (default `30 3 * * *`, settings `graceHours`, `batchSize` = 1000, dry run):
  - report: blobs examined, marked, rows deleted, orphan objects deleted, bytes freed, sample hashes with mime type and
    size;
  - uses the job context's cancellation check between batches.
- **Health.** `BlobStoreHealthIndicator` gains `lastSweep` (outcome and time) in its details.

## Acceptance criteria

- [ ] A blob referenced only by an old (closed) version of a media asset is kept. A blob referenced by nothing and older
      than the grace period is deleted (row and bytes).
- [ ] A blob uploaded one minute ago with no version yet (in-flight upload) is kept.
- [ ] Orphan bytes (an object without a row) from a simulated failed upload (bytes stored, transaction rolled back)
      are deleted after the grace period.
- [ ] Variants, localized files (M27) and `media_variant` blobs are marked (one test each).
- [ ] Filesystem and S3 stores (the S3 store against its existing test double or MinIO test container, as the
      `S3BlobStore` tests do).
- [ ] A dry run reports the same numbers and deletes nothing. `ref_count` is recomputed correctly.
- [ ] A concurrent upload of the same content during the sweep (same hash) never loses its bytes (test with a latch
      between mark and delete).
- [ ] `./gradlew build` green.

## Out of scope

- Compaction (it creates new unreferenced blobs, which this sweep then collects).
- Backup snapshots of the store (§26.5 ops).

## Notes / hazards

- **The concurrency window.** Mark reads a snapshot. A new version referencing an old, unmarked blob (re-upload of the
  same bytes → `storeBlob` finds the row and increments) can commit after mark.
  - Mitigation: the per-hash delete transaction re-checks that no version references the hash (an indexed or JSON
    query for that one hash, or the `ref_count` increment as a signal: take the row lock `FOR UPDATE`, and skip if
    `ref_count` or `created_at` changed since the mark).
  - `storeBlob` must take the same row lock when it finds an existing row. Specify and test this interplay; it is the
    one way the sweep could lose data.
- A restore drill (§26.5) that restores the DB to an earlier point may reference blobs swept after that point. Document
  it: the blob store snapshot must be at least as old as the grace period plus the backup interval, or run restore
  drills with the sweep disabled.
