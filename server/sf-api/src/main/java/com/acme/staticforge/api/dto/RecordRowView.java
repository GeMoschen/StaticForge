package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * One row of a record listing (M19.2.1): identity plus the record's scalar editor values only
 * ({@code text}, {@code number}, {@code date}, {@code boolean}, {@code select}, {@code color}, …).
 *
 * <p>{@code selectedBySet} is sent by a record set's grid only (M25): whether the set's stored query selects the
 * record ({@code false} for every row while the query is invalid). The dataset listing omits it.
 */
public record RecordRowView(
        UUID uuid,
        String uid,
        String displayName,
        String folderPath,
        Instant changedAt,
        Long changedBy,
        JsonNode values,
        @JsonInclude(JsonInclude.Include.NON_NULL) Boolean selectedBySet,
        java.util.Map<String, LocaleReleaseView> release,
        com.fasterxml.jackson.databind.JsonNode scheduled) {}
