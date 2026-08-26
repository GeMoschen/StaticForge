package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Client-facing {@code UrlRegistryEntry} row for the settings UI (`M8.2.4`). {@code
 * pageReferenceLabel} is joined in by the controller from the {@code PageReference} asset's
 * {@code label} payload field (falling back to {@code displayName}) so the UI doesn't need a
 * second call per row.
 */
public record UrlRegistryEntryView(
        Long id,
        String channelKey,
        UUID pageReferenceUuid,
        String pageReferenceLabel,
        String area,
        String url,
        boolean overridden,
        Instant assignedAt,
        long assignedRevision) {}
