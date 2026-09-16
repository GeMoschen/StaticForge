package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * A single compiled channel template as stored on a section/page template. {@code descendantWarnings} (M20.2.2) are
 * the warnings the save produced on templates that extend this one; empty otherwise.
 */
public record ChannelTemplateDto(
        String channelKey,
        String source,
        String compiledHash,
        JsonNode compiled,
        List<TemplateDetail.DescendantIssueDto> descendantWarnings) {}
