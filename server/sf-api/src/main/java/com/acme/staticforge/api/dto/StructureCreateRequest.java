package com.acme.staticforge.api.dto;

import com.acme.staticforge.structure.StructureKind;
import java.util.Map;
import java.util.UUID;

/** Create-structure request body (spec §17.1). */
public record StructureCreateRequest(
        String displayName,
        StructureKind kind,
        String sourceText,
        Map<String, String> channelSources,
        UUID folderUuid) {

    public StructureCreateRequest {
        channelSources = channelSources == null ? Map.of() : channelSources;
    }
}
