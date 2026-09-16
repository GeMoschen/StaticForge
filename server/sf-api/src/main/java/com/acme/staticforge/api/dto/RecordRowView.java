package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * One row of a record listing (M19.2.1): identity plus the record's scalar editor values only
 * ({@code text}, {@code number}, {@code date}, {@code boolean}, {@code select}, {@code color}, …).
 */
public record RecordRowView(
        UUID uuid, String uid, String displayName, String folderPath, Instant changedAt, Long changedBy, JsonNode values) {}
