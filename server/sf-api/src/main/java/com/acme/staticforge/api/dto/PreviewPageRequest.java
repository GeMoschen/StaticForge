package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** Live (unsaved) preview request body for {@code POST /preview/page} (spec §19.1). */
public record PreviewPageRequest(UUID templateUuid, JsonNode content, JsonNode bodies) {}
