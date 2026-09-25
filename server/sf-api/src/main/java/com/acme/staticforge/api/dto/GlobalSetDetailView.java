package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * One global property set in full (M17.2.1): the CDL source a developer edits, the compiled
 * definition the value form and the content validator are driven by, and the values themselves.
 * {@code revision} is also returned as {@code ETag: "rev-{n}"}.
 */
public record GlobalSetDetailView(
        UUID uuid,
        String uid,
        String displayName,
        String folderPath,
        String contentDefinition,
        JsonNode compiledDefinition,
        JsonNode content,
        long revision,
        java.util.Map<String, LocaleReleaseView> release,
        com.fasterxml.jackson.databind.JsonNode scheduled) {}
