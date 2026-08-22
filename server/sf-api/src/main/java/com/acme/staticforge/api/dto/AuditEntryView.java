package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** Client-facing audit trail entry (spec §26.3). */
public record AuditEntryView(
        Long id,
        Long projectId,
        Long actorUserId,
        String action,
        String target,
        JsonNode detail,
        Instant createdAt) {}
