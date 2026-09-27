package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.Map;

/**
 * What a generation plan decided and counts (M22.2.1): a run's stored plan summary, or a dry run's.
 *
 * @param mode the requested mode
 * @param incremental whether the plan is incremental ({@code false} when INCREMENTAL fell back to a full build)
 * @param fallbackCause why INCREMENTAL was planned as a full build: {@code NO_COMPLETE_BUILD_FOR_TARGET},
 *     {@code BASE_BUILD_MISSING}, {@code CHANNEL_SETTINGS_CHANGED}, {@code REVISION_BEFORE_BASELINE},
 *     {@code BASE_BUILD_WITHOUT_QUALITY_FACTS}, {@code QUALITY_RULES_CHANGED}
 * @param baselineRevision the revision an incremental plan counts changes from
 * @param baseRunId the build the run publishes on top of (incremental and scoped runs)
 * @param scoped whether the request limited the pages ({@code folderPath}/{@code assetUuids})
 * @param entryCount planned outputs: page outputs plus re-rendered processed media
 * @param byRootKind entry counts by reason root kind
 * @param byFirstEdge entry counts by the first edge of their chain ({@code NONE} without a chain)
 * @param via the largest groups of entries by first edge and the asset it leads to, largest first
 * @param planAvailable {@code false} once retention pruned a run's entries
 * @param redirectsAdded automatic redirects the build added or re-pointed (M30.4.2); a dry run: those it would add
 *     (it can't know which pages a run would hold back); {@code null} for a run that isn't published (or before M30)
 * @param redirectsActive redirects the build emitted; {@code null} for a dry run and a run that isn't published
 */
public record PlanSummaryView(
        String mode,
        boolean incremental,
        long revision,
        String fallbackCause,
        Long baselineRevision,
        Long baseRunId,
        boolean scoped,
        List<String> channels,
        int changedAssetCount,
        int entryCount,
        int pageCount,
        int processedMediaCount,
        Map<String, Integer> byRootKind,
        Map<String, Integer> byFirstEdge,
        Map<String, Integer> byChannel,
        List<Via> via,
        boolean planAvailable,
        Integer redirectsAdded,
        Integer redirectsActive) {

    /** {@code count} entries whose chain starts with {@code edge} to the asset. */
    public record Via(String edge, String assetUuid, String assetType, String uid, int count) {}
}
