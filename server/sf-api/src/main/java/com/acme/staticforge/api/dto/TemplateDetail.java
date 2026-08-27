package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Full section/page template representation, surfaced from the asset version payload.
 * {@code folderUuid}/{@code folderPath} mirror {@code PageView}'s shape (spec M13.1.3).
 */
public record TemplateDetail(
        UUID uuid,
        String uid,
        String assetType,
        String displayName,
        long revision,
        String contentDefinition,
        JsonNode compiledDefinition,
        JsonNode channelTemplates,
        String category,
        boolean deprecated,
        JsonNode bodies,
        JsonNode outputPath,
        UUID folderUuid,
        String folderPath) {}
