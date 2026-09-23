package com.acme.staticforge.asset.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * Read model of one record at a single revision (M19.1.2). {@code recordSetUuid}/{@code recordSetUid}/
 * {@code recordSetDisplayName} name the set holding it (M25); {@code folderUuid}/{@code folderPath} the set's Content folder, the path
 * Content-store relative ({@code /team/}); {@code revision} is the {@code ETag: "rev-{n}"} concurrency token.
 */
public record RecordDetail(
        UUID uuid,
        String uid,
        String displayName,
        UUID datasetUuid,
        String datasetUid,
        UUID recordSetUuid,
        String recordSetUid,
        String recordSetDisplayName,
        UUID folderUuid,
        String folderPath,
        JsonNode content,
        long revision,
        Long changedBy,
        Instant changedAt,
        boolean deleted) {}
