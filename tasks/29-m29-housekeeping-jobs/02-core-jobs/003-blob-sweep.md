---
id: M29.2.3
status: done
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

- [x] A blob referenced only by an old (closed) version of a media asset is kept. A blob referenced by nothing and older
      than the grace period is deleted (row and bytes).
- [x] A blob uploaded one minute ago with no version yet (in-flight upload) is kept.
- [x] Orphan bytes (an object without a row) from a simulated failed upload (bytes stored, transaction rolled back)
      are deleted after the grace period.
- [x] Variants, localized files (M27) and `media_variant` blobs are marked (one test each).
- [x] Filesystem and S3 stores (the S3 store against its existing test double or MinIO test container, as the
      `S3BlobStore` tests do).
- [x] A dry run reports the same numbers and deletes nothing. `ref_count` is recomputed correctly.
- [x] A concurrent upload of the same content during the sweep (same hash) never loses its bytes (test with a latch
      between mark and delete).
- [x] `./gradlew build` green.

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

### Deviations

- **Job** `housekeeping.blobs.BlobSweepJob` + `BlobSweepProperties` (`sf.housekeeping.blob-sweep.grace-hours`/
  `batch-size`). Report: `versionsScanned`, `marked`, `rowsExamined`, `objectsExamined`, `rowsDeleted`,
  `orphanObjectsDeleted`, `keptWithinGrace`, `skippedChanged`, `refCountsUpdated`, sample items
  `{sha256, kind: row|object, mimeType, sizeBytes}`; counters examined/affected/bytes freed.
- **Mark in Java, not SQL JSON paths**: `MEDIA` payloads are streamed in id pages (`MediaVersionRepository.
  findEveryMediaVersionAfter`, deleted and closed versions included) and read with the new `MediaFiles.blobShas`
  (file, variants, and every `localeFiles` entry — the M27 key `localeFiles`). A test pins `AssetType.values()` and
  checks that no non-media payload in the test DB contains `blobSha256`, so a new referencing type fails loudly.
- **Concurrency: `blob.last_referenced_at` (new column, changeset `026-blob-last-referenced`)** instead of comparing
  `ref_count`/`created_at` with the mark: a write that reused a blob after the mark had committed its increment before
  the sweep read the row, so a mark-time comparison needs a snapshot of every row. `BlobWriter` (the new shared write
  path for uploads, text writes, variants and imports) locks an existing row `FOR UPDATE`
  (`BlobRepository.findForUpdate`), increments `ref_count` and sets `last_referenced_at`; the sweep deletes only when
  `COALESCE(last_referenced_at, created_at)` is older than the grace period, re-checked under the same lock (plus the
  `media_variant`/run references). A writer waiting on the lock finds no row afterwards and stores the bytes again.
- **Delete order**: under the lock, the object first, then the row, in one transaction. A crash in between leaves a
  row without bytes: the next sweep deletes the (still unreferenced) row, and `BlobWriter` rewrites missing bytes
  when it reuses a row.
- **Orphan objects** are claimed by inserting a placeholder row with their key (deleted with the object in the same
  transaction). `BlobWriter` now inserts a new row (flushed) *before* writing the bytes, so a concurrent write of the
  same bytes waits for the claim and then writes them, or makes the claim fail (skipped).
- **`ref_count`** = version rows + `media_variant` rows naming the blob as variant + runs; a variant's `source_sha` is
  marked (kept) but not counted. Surviving unmarked rows within the grace period get `0`.
- **S3**: `S3BlobStore` is still a stub (every call "not implemented"), and there were no S3 tests or MinIO here.
  `BlobStore.forEachObject` was added (filesystem walk; S3 stub throws like its other methods, to be done with
  `ListObjectsV2`). `BlobSweepObjectStoreIntegrationTest` runs the sweep against an in-memory object-store double
  selected by `sf.media.store`, proving the sweep only depends on the `BlobStore` contract.
- The sweep test context uses its own `sf.media.root`: the sweep lists the whole store, and the shared test root holds
  bytes of other contexts (other in-memory databases).
- **Health**: `BlobStoreHealthIndicator` details gain `lastSweep` `{outcome, finishedAt, dryRun}`.
- **Docs**: `Blob`/`BlobStore`/`BlobWriter` Javadoc, the `007` changelog comment, spec §11.2 (mark and sweep,
  derived `ref_count`, `last_referenced_at`) and the backup runbook (restore drills vs. the sweep) are updated.
- Tests: `BlobSweepIntegrationTest` (7: mark/sweep + dry run + in-flight + health; orphan bytes of a rolled-back
  write; variants, per-locale files, `media_variant`, `ref_count`; re-upload after the mark; an upload waiting on the
  row lock; an upload waiting on an orphan claim; asset types pinned), `BlobSweepObjectStoreIntegrationTest` (1).
