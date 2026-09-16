package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.UUID;

/**
 * Listing summary of a section/page template's current version. {@code abstract} and {@code parentTemplateRef}
 * (M20) let pickers leave out layouts pages can't use.
 */
public record TemplateSummary(
        UUID uuid,
        String uid,
        String assetType,
        String displayName,
        String folderPath,
        long revision,
        @JsonProperty("abstract") boolean abstractTemplate,
        UUID parentTemplateRef) {}
