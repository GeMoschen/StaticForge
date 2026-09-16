package com.acme.staticforge.asset.content;

import java.util.Optional;
import java.util.UUID;

/**
 * Resolves which dataset a record belongs to (M19.3.2), so content validation can check a
 * {@code reference} editor restricted with {@code dataset "uid"}. Save paths supply a
 * project-scoped, repository-backed lookup; without one only the value's {@code assetType} is checked.
 */
@FunctionalInterface
public interface RecordDatasetLookup {

    /** The uid of the dataset the live record {@code recordUuid} belongs to; empty when no such record exists. */
    Optional<String> datasetUidOf(UUID recordUuid);
}
