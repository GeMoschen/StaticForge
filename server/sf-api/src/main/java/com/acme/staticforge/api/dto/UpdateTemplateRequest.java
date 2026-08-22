package com.acme.staticforge.api.dto;

import java.util.Map;

/** Update-template request body (spec §12.1, §13.2). */
public record UpdateTemplateRequest(
        String displayName,
        String contentDefinition,
        Map<String, String> channelSources,
        String category,
        Boolean deprecated,
        Map<String, String> outputPath) {}
