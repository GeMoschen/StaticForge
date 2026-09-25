package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Listing summary of a media asset's current version (spec §20.2); {@code processCms} marks processed text media and {@code textEditable} text media (M18). */
public record MediaSummaryView(
        UUID uuid,
        String uid,
        String displayName,
        String mimeType,
        Long sizeBytes,
        String folderPath,
        long revision,
        boolean processCms,
        boolean textEditable,
        java.util.Map<String, LocaleReleaseView> release,
        com.fasterxml.jackson.databind.JsonNode scheduled) {}
