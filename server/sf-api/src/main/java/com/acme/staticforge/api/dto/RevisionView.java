package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/**
 * Client-facing revision record. {@code compacted} (M29.4.3): revision compaction absorbed the revision's own changes
 * (some removed version started at it); the revision itself, its summary and author stay.
 */
public record RevisionView(
        Long projectId,
        Long revisionId,
        Instant createdAt,
        Long createdBy,
        String changeType,
        String comment,
        JsonNode summary,
        boolean compacted) {}
