package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.template.query.RecordSetQuery;
import java.util.UUID;

/**
 * Command to create a record set (M25). {@code folderUuid} {@code null} means the Content store root;
 * {@code uid} {@code null} derives one from the display name; {@code query} {@code null} is
 * {@link RecordSetQuery#ALL}. The dataset is fixed for the set's lifetime.
 */
public record CreateRecordSetCommand(
        long projectId, UUID folderUuid, UUID datasetUuid, String uid, String displayName, RecordSetQuery query) {}
