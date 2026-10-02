package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/**
 * Client-facing revision record. {@code createdByName}: the author's display name, {@code null} when the account is
 * unknown or was deleted. {@code summary.assets[]} entries carry, besides the stored fields, {@code name} (the item's
 * display name as of the revision) and {@code locales} (language codes whose content changed; empty when the whole item
 * was affected or the change can't be told per language).
 {@code compacted} (M29.4.3): revision compaction absorbed the revision's own changes
 * (some removed version started at it); the revision itself, its summary and author stay.
 */
public record RevisionView(
        Long projectId,
        Long revisionId,
        Instant createdAt,
        Long createdBy,
        String createdByName,
        String changeType,
        String comment,
        JsonNode summary,
        boolean compacted) {}
