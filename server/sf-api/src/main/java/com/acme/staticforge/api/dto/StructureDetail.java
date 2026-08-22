package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** Full structure representation, surfaced from the asset version payload. */
public record StructureDetail(
        UUID uuid,
        String uid,
        String displayName,
        String kind,
        String sourceText,
        JsonNode source,
        JsonNode channelTemplates,
        long revision) {}
