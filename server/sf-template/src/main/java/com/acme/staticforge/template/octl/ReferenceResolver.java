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
}
