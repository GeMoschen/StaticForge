package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

/**
 * Update-template request body (spec §12.1, §13.2). {@code abstract} (M20, page templates) makes the template a
 * layout pages can't use; {@code parentTemplateRef} is never accepted, it is derived from the channel sources.
 */
public record UpdateTemplateRequest(
        String displayName,
        String contentDefinition,
        Map<String, String> channelSources,
        String category,
        Boolean deprecated,
        Map<String, String> outputPath,
        @JsonProperty("abstract") Boolean abstractTemplate) {}
