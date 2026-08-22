package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Listing summary of a section/page template's current version. */
public record TemplateSummary(
        UUID uuid, String uid, String assetType, String displayName, String folderPath, long revision) {}
