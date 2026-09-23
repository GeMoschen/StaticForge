package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * One record set in a listing (M25.3.1). {@code folderPath} is the Content folder holding the set,
 * Content-store relative ({@code /team/}); {@code recordCount} counts its live records; {@code queryValid}
 * is {@code false} when the stored query no longer validates against the dataset schema (the set then
 * renders no records until it is saved with a valid query).
 */
public record RecordSetSummaryView(
        UUID uuid,
        String uid,
        String displayName,
        AssetRefView dataset,
        UUID folderUuid,
        String folderPath,
        long recordCount,
        boolean queryValid,
        long revision) {}
