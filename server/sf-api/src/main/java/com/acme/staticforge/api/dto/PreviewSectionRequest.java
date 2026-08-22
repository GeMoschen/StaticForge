package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** Section preview request body for {@code POST /preview/section} (spec §19.1). */
public record PreviewSectionRequest(UUID templateUuid, JsonNode sampleContent) {}
