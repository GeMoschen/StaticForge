package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/**
 * One planned output and why it is rebuilt (M22.2.1): a page's output in a channel, or a processed media file
 * ({@code channel} null).
 *
 * @param locale the language the output renders (M27.2.2); {@code null} without locales and for media
 */
public record PlanEntryView(
        UUID assetUuid,
        String assetType,
        String uid,
        String displayName,
        String channel,
        String outputPath,
        Integer pageNumber,
        ReasonView reason,
        String locale) {

    /**
     * The reason: a root kind, and for a change the chain from the planned asset back to it.
     *
     * @param rootKind {@code FULL_BUILD}, {@code INCREMENTAL_FALLBACK_FULL}, {@code EXPLICIT_SCOPE}, {@code ASSET_CHANGED},
     *     {@code ASSET_RELEASED}, {@code ASSET_UNPUBLISHED}, {@code ASSET_DELETED}, {@code NOT_IN_BASE_BUILD}; clients must tolerate names added later
     * @param rootAsset the change, the explicitly selected asset or the asset missing from the base build
     * @param causeCount how many distinct changes reach the asset
     * @param steps ordered from the planned asset towards the root, the root excluded
     */
    public record ReasonView(
            String rootKind, AssetRef rootAsset, Long rootRevision, int causeCount, String fallbackCause, List<StepView> steps) {}

    public record AssetRef(UUID uuid, String type, String uid) {}

    /**
     * One asset of a chain and how it depends on the next one.
     *
     * @param edge {@code PAGE_TEMPLATE}, {@code SECTION_TEMPLATE}, {@code PARENT_TEMPLATE}, {@code REFERENCE},
     *     {@code NAVIGATION}, {@code DATASET_MEMBERSHIP}, {@code PAGINATION_SOURCE}, {@code RECORD_SET_MEMBERSHIP},
     *     {@code RECORD_SET_QUERY}, {@code RECORD_TEMPLATE}, {@code START_PAGE}; clients must tolerate names added later
     * @param referenceKind the reference row's kind for a {@code REFERENCE} edge
     */
    public record StepView(UUID assetUuid, String assetType, String uid, String edge, String referenceKind, String sourcePath) {}
}
