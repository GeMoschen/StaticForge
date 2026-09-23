package com.acme.staticforge.template.octl;

import java.util.Optional;
import java.util.UUID;

/**
 * Resolves an {@code assetType:uid} reference to an asset UUID at OCTL compile time
 * (spec §16.4). Keeps {@code sf-template} free of any {@code sf-domain} dependency: the
 * domain layer supplies the implementation backed by {@code AssetRepository}.
 */
@FunctionalInterface
public interface ReferenceResolver {

    /** Returns the target asset's UUID, or empty when the reference cannot be resolved. */
    Optional<UUID> resolve(String assetType, String uid);

    /**
     * The content definition of the dataset {@code datasetUuid} (M19.3.2), used to report unknown or
     * unsortable fields in a dataset loop's {@code where}/{@code sort}. Only the template-save resolver
     * provides it; every other resolver (generation, preview) skips the field checks, so a later
     * schema change can never break a build that compiled before it.
     */
    default Optional<com.acme.staticforge.template.content.ContentDefinition> datasetDefinition(UUID datasetUuid) {
        return Optional.empty();
    }

    /**
     * The dataset of the record set {@code setUuid} (M25.2.2), so a {@code $CMS_FOR(x : recordset:uid, …)$} loop's
     * {@code where}/{@code sort} fields are checked against the set's dataset through {@link #datasetDefinition}. Like
     * that method, only the template-save resolver provides it.
     */
    default Optional<UUID> recordSetDataset(UUID setUuid) {
        return Optional.empty();
    }
}
