package com.acme.staticforge.asset.content;

import com.acme.staticforge.template.content.ContentDefinition;
import java.util.Optional;
import java.util.UUID;

/**
 * Resolves the source a {@code pagination} value points at (M21.1.1), so content validation can check that a
 * navigation source is a live navigation folder and a dataset source a live dataset whose schema declares the sort
 * field. Save paths supply a project-scoped, repository-backed lookup; without one only the value's shape is checked.
 */
public interface PaginationSourceLookup {

    /** Whether {@code uuid} is a live folder of the Navigation store. */
    boolean isNavigationFolder(UUID uuid);

    /** The schema of the live dataset {@code uuid}; empty when it is not a live dataset. */
    Optional<ContentDefinition> datasetSchema(UUID uuid);
}
