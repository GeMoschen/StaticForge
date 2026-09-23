package com.acme.staticforge.api.dto;

import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.template.query.RecordSetQueryDiagnostic;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One record set in full (M25.3.1): its dataset, its Content folder and its stored query. {@code query}
 * holds only the parts that are set ({@code where}, {@code sort}, {@code limit}, {@code offset}).
 * {@code queryValid}/{@code queryDiagnostics} check the stored query against the dataset schema of the
 * same revision, each finding naming its query part and the position inside it. {@code revision} is also
 * {@code ETag: "rev-{n}"}.
 */
public record RecordSetDetailView(
        UUID uuid,
        String uid,
        String displayName,
        AssetRefView dataset,
        UUID folderUuid,
        String folderPath,
        RecordSetQuery query,
        boolean queryValid,
        List<RecordSetQueryDiagnostic> queryDiagnostics,
        long recordCount,
        long revision,
        Long changedBy,
        Instant changedAt,
        boolean deleted) {}
