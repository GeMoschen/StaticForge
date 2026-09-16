package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;
import java.util.UUID;

/**
 * Create-template request body (spec §12.1, §13.2). {@code parentFolderUuid} is optional
 * (spec M13.1.3): when omitted, the template lands under the project's fixed "Page Templates"
 * / "Section Templates" root matching the endpoint's kind. {@code abstract} (M20, page templates) makes the
 * template a layout pages can't use.
 */
public record CreateTemplateRequest(
        String displayName,
        String contentDefinition,
        Map<String, String> channelSources,
        String category,
        Boolean deprecated,
        Map<String, String> outputPath,
        UUID parentFolderUuid,
        @JsonProperty("abstract") Boolean abstractTemplate) {}
