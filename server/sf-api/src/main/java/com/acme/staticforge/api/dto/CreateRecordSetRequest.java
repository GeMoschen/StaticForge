package com.acme.staticforge.api.dto;

import com.acme.staticforge.template.query.RecordSetQuery;
import java.util.UUID;

/**
 * Create a record set (M25.3.1) of the dataset {@code datasetUuid} (required, fixed for the set's
 * lifetime) in the Content folder {@code folderUuid} ({@code null}: the Content store root). {@code uid}
 * may be omitted (derived from the display name); {@code query} may be omitted (every record, default
 * order).
 */
public record CreateRecordSetRequest(
        UUID folderUuid, UUID datasetUuid, String uid, String displayName, RecordSetQuery query, String comment) {}
