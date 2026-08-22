package com.acme.staticforge.asset;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * Projection of an asset's state at a single revision, combining the immutable identity
 * columns (from {@link Asset}) with the mutable state columns (from {@link AssetVersion}).
 * The {@code validFromRevision} value doubles as the optimistic-concurrency token (§7.5).
 */
public record AssetVersionView(
        UUID uuid,
        String uid,
        AssetType type,
        String displayName,
        JsonNode payload,
        long validFromRevision,
        boolean deleted,
        Long folderId,
        String folderPath,
        Long templateAssetId,
        Long changedBy,
        Instant changedAt) {}
