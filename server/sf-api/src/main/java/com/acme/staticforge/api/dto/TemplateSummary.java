package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Listing summary of a section/page template's current version. {@code abstract} and {@code parentTemplateRef}
 * (M20) let pickers leave out layouts pages can't use.
 * {@code channels} (sorted keys with a source), {@code usedByCount} (current inbound references) and
 * {@code changedAt} feed the Templates folder table.
 */
public record TemplateSummary(
        UUID uuid,
        String uid,
        String assetType,
        String displayName,
        String folderPath,
        long revision,
        @JsonProperty("abstract") boolean abstractTemplate,
        UUID parentTemplateRef,
        List<String> channels,
        int usedByCount,
        Instant changedAt) {}
