package com.acme.staticforge.asset.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * Read model of one record at a single revision (M19.1.2). {@code folderPath} is Content-store
 * relative ({@code /team/}); {@code revision} is the {@code ETag: "rev-{n}"} concurrency token.
 */
public record RecordDetail(
        UUID uuid,
        String uid,
        String displayName,
        UUID datasetUuid,
        String datasetUid,
        UUID folderUuid,
        String folderPath,
        JsonNode content,
        long revision,
        Long changedBy,
        Instant changedAt,
        boolean deleted) {}
