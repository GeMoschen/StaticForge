package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;
import java.util.UUID;

/**
 * Create-template request body (spec §12.1, §13.2). {@code parentFolderUuid} is optional (spec M13.1.3): when omitted,
 * the template lands under the project's fixed "Page Templates" / "Section Templates" root matching the endpoint's
 * kind. {@code abstract} (M20, page templates) makes the template a layout pages can't use. {@code paginationPath}
 * (M21.2.1, page templates) maps a channel to the path pattern of pages 2..N of a paginated page; it must contain
 * {@code {pageNumber}}. The CDL comes as its three sections (M34): {@code contentCdl}, {@code bodiesCdl} and {@code
 * rulesCdl}, each the text inside its {@code content}/{@code bodies}/{@code rules} braces.
 */
public record CreateTemplateRequest(
        String displayName,
        String contentCdl,
        String bodiesCdl,
        String rulesCdl,
        Map<String, String> channelSources,
        String category,
        Boolean deprecated,
        Map<String, String> outputPath,
        UUID parentFolderUuid,
        @JsonProperty("abstract") Boolean abstractTemplate,
        Map<String, String> paginationPath) {}
