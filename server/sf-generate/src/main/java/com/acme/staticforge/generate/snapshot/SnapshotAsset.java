package com.acme.staticforge.generate.snapshot;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * A point-in-time view of a single asset, resolved against one revision (spec §18.2).
 * {@code changedAt} is when that version was written (a record's {@code _changedAt}, M19.3.2).
 */
public record SnapshotAsset(
        UUID uuid,
        long assetId,
        AssetType type,
        String uid,
        String displayName,
        String folderPath,
        JsonNode payload,
        boolean deleted,
        Instant changedAt) {

    /** A snapshot asset without a change time (tests and fixtures that don't read it). */
    public SnapshotAsset(
            UUID uuid, long assetId, AssetType type, String uid, String displayName, String folderPath, JsonNode payload,
            boolean deleted) {
        this(uuid, assetId, type, uid, displayName, folderPath, payload, deleted, null);
    }
}
