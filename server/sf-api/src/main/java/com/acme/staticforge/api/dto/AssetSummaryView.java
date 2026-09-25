package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Listing summary of an asset's current version. */
public record AssetSummaryView(
        UUID uuid, String uid, String type, String displayName, String folderPath, long revision,
        java.util.Map<String, LocaleReleaseView> release,
        java.util.List<ScheduledRefView> scheduled) {}
