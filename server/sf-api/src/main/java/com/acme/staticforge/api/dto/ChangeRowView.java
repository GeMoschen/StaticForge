package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * One row of the Changes view (M27.1.3): an (asset, locale) whose status isn't {@code PUBLISHED}. {@code changedBy}
 * and {@code changedAt} describe the draft, the {@code released*} fields the current release ({@code null} when
 * nothing is released in that locale). {@code scheduled} is filled by M27.4.4.
 */
public record ChangeRowView(
        UUID uuid,
        String type,
        String uid,
        String displayName,
        String folderPath,
        String locale,
        String status,
        Long changedBy,
        Instant changedAt,
        Long releasedRevision,
        Long releasedBy,
        Instant releasedAt,
        JsonNode scheduled) {}
