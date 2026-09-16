package com.acme.staticforge.asset.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Read model of one dataset schema at a single revision (M19.1.2). {@code recordCount} counts the
 * current, live records (it is not revision-pinned); {@code revision} is the version's
 * {@code validFromRevision}, the {@code ETag: "rev-{n}"} concurrency token.
 */
public record DatasetView(
        UUID uuid,
        String uid,
        String displayName,
        UUID folderUuid,
        String folderPath,
        String contentDefinition,
        JsonNode compiledDefinition,
        String titleEditor,
        String description,
        long recordCount,
        long revision,
        boolean deleted) {}
