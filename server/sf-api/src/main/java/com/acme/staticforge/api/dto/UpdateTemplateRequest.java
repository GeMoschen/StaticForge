package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

/**
 * Update-template request body (spec §12.1, §13.2). {@code abstract} (M20, page templates) makes the template a layout
 * pages can't use; {@code parentTemplateRef} is never accepted, it is derived from the channel sources. {@code
 * paginationPath} (M21.2.1) replaces the stored per-channel pagination path patterns. The CDL comes as its three
 * sections (M34): {@code contentCdl}, {@code bodiesCdl} and {@code rulesCdl}, each the text inside its {@code
 * content}/{@code bodies}/{@code rules} braces.
 */
public record UpdateTemplateRequest(
        String displayName,
        String contentCdl,
        String bodiesCdl,
        String rulesCdl,
        Map<String, String> channelSources,
        String category,
        Boolean deprecated,
        Map<String, String> outputPath,
        @JsonProperty("abstract") Boolean abstractTemplate,
        Map<String, String> paginationPath) {}
