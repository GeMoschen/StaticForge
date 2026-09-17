package com.acme.staticforge.generate.plan;

import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.insight.FallbackCause;
import java.util.Set;
import java.util.UUID;

/**
 * What to plan (spec §18.1): the requested mode with its baseline, channels and scope.
 *
 * @param baseline the incremental baseline; {@code null} plans FULL
 * @param fallbackCause why an INCREMENTAL request has no baseline; recorded on every entry's reason
 * @param channels the channels to plan; {@code null} or empty plans the default channel
 * @param scopeFolderPath only pages in this folder (and below); {@code null} for no folder scope
 * @param scopeAssetUuids only these pages; {@code null} for no asset scope (with a folder scope too, either qualifies)
 */
public record PlanRequest(
        GenerationMode mode,
        Baseline baseline,
        FallbackCause fallbackCause,
        Set<String> channels,
        String scopeFolderPath,
        Set<UUID> scopeAssetUuids) {

    /** Whether the request limits the pages planned. */
    public boolean scoped() {
        return (scopeFolderPath != null && !scopeFolderPath.isBlank())
                || (scopeAssetUuids != null && !scopeAssetUuids.isEmpty());
    }
}
