package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** Full page representation, with the resolved template definition. */
public record PageView(
        UUID uuid,
        String uid,
        String displayName,
        long revision,
        String folderPath,
        TemplateView template,
        JsonNode content,
        JsonNode bodies,
        JsonNode nav,
        JsonNode output,
        JsonNode meta) {}
