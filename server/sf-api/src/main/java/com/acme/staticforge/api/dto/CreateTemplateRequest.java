package com.acme.staticforge.api.dto;

import java.util.Map;

/** Create-template request body (spec §12.1, §13.2). */
public record CreateTemplateRequest(
        String displayName,
        String contentDefinition,
        Map<String, String> channelSources,
        String category,
        Boolean deprecated,
        Map<String, String> outputPath) {}
