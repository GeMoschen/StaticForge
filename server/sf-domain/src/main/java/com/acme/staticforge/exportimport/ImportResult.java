package com.acme.staticforge.exportimport;

/**
 * Outcome of an import operation: the source project identity (for provenance) and the
 * number of assets and content-addressed blobs recreated in the target project.
 */
public record ImportResult(String sourceProjectKey, int importedAssetCount, int importedBlobCount) {}
