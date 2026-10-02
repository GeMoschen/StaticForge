package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * Listing summary of an asset's current version. A page listing also carries what a folder table shows besides the
 * release status: the page template's name and who changed the page when ({@code changedByName} is {@code null} when the
 * account is unknown or deleted); other listings leave these {@code null}.
 */
public record AssetSummaryView(
        UUID uuid, String uid, String type, String displayName, String folderPath, long revision,
        java.util.Map<String, LocaleReleaseView> release,
        java.util.List<ScheduledRefView> scheduled,
        String templateName, java.time.Instant changedAt, Long changedBy, String changedByName) {

    /** The summary without the page columns. */
    public AssetSummaryView(
            UUID uuid, String uid, String type, String displayName, String folderPath, long revision,
            java.util.Map<String, LocaleReleaseView> release,
            java.util.List<ScheduledRefView> scheduled) {
        this(uuid, uid, type, displayName, folderPath, revision, release, scheduled, null, null, null, null);
    }
}
