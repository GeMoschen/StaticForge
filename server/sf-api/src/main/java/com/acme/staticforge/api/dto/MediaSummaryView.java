package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * Listing summary of a media asset's current version (spec §20.2); {@code processCms} marks processed text media and
 * {@code textEditable} text media (M18), {@code localized} media with one file per language (M27.3.1). {@code width} and
 * {@code height} are the pixel size of a picture (absent for other files), {@code changedAt} when the current version was
 * written and {@code usageCount} how many places reference the file (M35.19: the library's list view).
 */
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
        boolean localized,
        Integer width,
        Integer height,
        java.time.Instant changedAt,
        int usageCount,
        java.util.Map<String, LocaleReleaseView> release,
        java.util.List<ScheduledRefView> scheduled) {}
