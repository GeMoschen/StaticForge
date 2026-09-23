package com.acme.staticforge.asset.dataset;

import java.time.Instant;
import java.util.UUID;

/**
 * Read model of one record set at a single revision (M25). {@code folderUuid}/{@code folderPath} name the
 * Content folder holding the set ({@code folderPath} Content-store relative, {@code /team/});
 * {@code recordCount} counts its live records at that revision; {@code revision} is the version's
 * {@code validFromRevision}, the {@code ETag: "rev-{n}"} concurrency token.
 */
public record RecordSetView(
        UUID uuid,
        String uid,
        String displayName,
        UUID datasetUuid,
        String datasetUid,
        String datasetDisplayName,
        UUID folderUuid,
        String folderPath,
        RecordSetQuery query,
        long recordCount,
        long revision,
        Long changedBy,
        Instant changedAt,
        boolean deleted) {}
