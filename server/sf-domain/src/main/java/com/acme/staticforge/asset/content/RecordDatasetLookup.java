package com.acme.staticforge.asset.content;

import java.util.Optional;
import java.util.UUID;

/**
 * Resolves which dataset a record (M19.3.2) or a record set (M25.2.2) belongs to, so content validation can
 * check a {@code reference} editor restricted with {@code dataset "uid"}. Save paths supply a project-scoped,
 * repository-backed lookup; without one only the value's {@code assetType} is checked.
 */
@FunctionalInterface
public interface RecordDatasetLookup {

    /**
     * The uid of the dataset the live record or record set {@code uuid} belongs to; empty when no such record or
     * set exists.
     */
    Optional<String> datasetUidOf(UUID uuid);
}
