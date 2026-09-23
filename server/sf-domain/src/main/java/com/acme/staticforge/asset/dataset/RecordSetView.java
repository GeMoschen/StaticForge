package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.template.query.RecordSetQueryDiagnostic;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Read model of one record set at a single revision (M25). {@code folderUuid}/{@code folderPath} name the
 * Content folder holding the set ({@code folderPath} Content-store relative, {@code /team/});
 * {@code recordCount} counts its live records at that revision; {@code revision} is the version's
 * {@code validFromRevision}, the {@code ETag: "rev-{n}"} concurrency token.
 *
 * <p>{@code queryValid}/{@code queryDiagnostics} are computed on read (M25.1.2): the stored query checked
 * against the dataset schema of the same revision. A set whose query no longer validates (a field removed
 * or retyped since it was saved) renders no records until it is saved with a valid query.
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
        boolean queryValid,
        List<RecordSetQueryDiagnostic> queryDiagnostics,
        long recordCount,
        long revision,
        Long changedBy,
        Instant changedAt,
        boolean deleted) {

    public RecordSetView {
        queryDiagnostics = queryDiagnostics == null ? List.of() : List.copyOf(queryDiagnostics);
    }
}
