package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/** Type-polymorphic representation of a single asset at its current revision. */
public record AssetDetailView(
        UUID uuid,
        String uid,
        String type,
        String displayName,
        JsonNode payload,
        long revision,
        boolean deleted,
        String folderPath,
        Long changedBy,
        Instant changedAt,
        java.util.Map<String, LocaleReleaseView> release,
        java.util.List<ScheduledRefView> scheduled,
        boolean compacted) {}
