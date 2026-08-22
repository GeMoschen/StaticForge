package com.acme.staticforge.api.dto;

import java.util.Map;

/** Update-structure request body (spec §17.1). */
public record StructureUpdateRequest(String displayName, String sourceText, Map<String, String> channelSources) {

    public StructureUpdateRequest {
        channelSources = channelSources == null ? Map.of() : channelSources;
    }
}
