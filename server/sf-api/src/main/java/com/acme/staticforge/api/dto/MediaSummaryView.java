package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Listing summary of a media asset's current version (spec §20.2). */
public record MediaSummaryView(
        UUID uuid, String uid, String displayName, String mimeType, Long sizeBytes, String folderPath, long revision) {}
