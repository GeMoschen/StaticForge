package com.acme.staticforge.generate.snapshot;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** A point-in-time view of a single asset, resolved against one revision (spec §18.2). */
public record SnapshotAsset(
        UUID uuid,
        long assetId,
        AssetType type,
        String uid,
        String displayName,
        String folderPath,
        JsonNode payload,
        boolean deleted) {}
