package com.acme.staticforge.exportimport;

/**
 * Outcome of an import operation: the source project identity (for provenance), the number
 * of brand-new assets created, the number of pre-existing (same-UUID/same-type) assets
 * overwritten with the archive's content, the number of content-addressed blobs
 * recreated in the target project, and the number of release pointers opened (M27.5.1: one per asset and locale
 * released by a {@link ReleaseMode#KEEP} import).
 */
public record ImportResult(
        String sourceProjectKey, int importedAssetCount, int updatedAssetCount, int importedBlobCount,
        int releasedCount) {}
