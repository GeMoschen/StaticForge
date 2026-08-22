package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** Client-facing revision record. */
public record RevisionView(
        Long projectId,
        Long revisionId,
        Instant createdAt,
        Long createdBy,
        String changeType,
        String comment,
        JsonNode summary) {}
