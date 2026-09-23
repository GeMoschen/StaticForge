package com.acme.staticforge.api.dto;

import com.acme.staticforge.asset.content.ContentIssue;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One record in full (M19.2.1). {@code recordSet} is the record set holding it (M25); {@code folderUuid}/
 * {@code folderPath} name that set's Content folder, {@code folderPath} relative to the Content store ({@code /team/});
 * {@code issues} lists completeness findings (e.g. an empty required field) after a save, which do
 * not block it, and is empty on reads. {@code revision} is also {@code ETag: "rev-{n}"}.
 */
public record RecordDetailView(
        UUID uuid,
        String uid,
        String displayName,
        UUID datasetUuid,
        String datasetUid,
        AssetRefView recordSet,
        UUID folderUuid,
        String folderPath,
        JsonNode content,
        long revision,
        Long changedBy,
        Instant changedAt,
        boolean deleted,
        List<ContentIssue> issues) {}
