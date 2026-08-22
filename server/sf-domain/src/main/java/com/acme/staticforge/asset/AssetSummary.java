package com.acme.staticforge.asset;

import java.util.UUID;

/** Listing summary of an asset's current version. */
public record AssetSummary(
        UUID uuid, String uid, AssetType type, String displayName, String folderPath, long validFromRevision) {}
