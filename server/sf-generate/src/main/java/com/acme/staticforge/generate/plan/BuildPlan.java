package com.acme.staticforge.generate.plan;

import com.acme.staticforge.generate.insight.FallbackCause;
import com.acme.staticforge.generate.insight.RebuildReason;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The result of build planning (spec §18.3): an ordered list of render units plus the set of
 * asset UUIDs known to have changed since the last successful run (drives incremental
 * planning and the dependency re-sync). An empty {@code entries} list is a valid, successful
 * build (nothing to render).
 *
 * <p>{@code processedMedia} (M18.3.1) lists the processed text media an incremental build must
 * re-render even when no re-rendered page references it (for example only a global value it reads
 * changed). Entries stay page-only; a full build leaves the set empty and renders the processed media
 * its pages reference.
 *
 * <p>Build insight (M22): {@code siteOutputs} is every output the site has in the planned channels and scope, whether
 * rendered or not (the same list as {@code entries} for a FULL plan) — what post-processing lists and what a carried
 * build must hold. {@code reasons} explains every planned asset (each page of {@code entries} and each file of
 * {@code processedMedia}); all outputs of one asset share its reason.
 *
 * @param changeRevisions the newest revision each changed asset changed in
 * @param fallbackCause why an INCREMENTAL request was planned FULL; {@code null} otherwise
 * @param baselineRevision the revision an incremental plan counted changes from; {@code null} for FULL
 */
public record BuildPlan(
        boolean incremental,
        long revision,
        List<PlanEntry> entries,
        Set<UUID> changedAssets,
        Set<UUID> processedMedia,
        List<PlanEntry> siteOutputs,
        Map<UUID, RebuildReason> reasons,
        Map<UUID, Long> changeRevisions,
        FallbackCause fallbackCause,
        Long baselineRevision) {

    public BuildPlan {
        entries = entries == null ? List.of() : List.copyOf(entries);
        changedAssets = changedAssets == null ? Set.of() : Set.copyOf(changedAssets);
        processedMedia = processedMedia == null ? Set.of() : Set.copyOf(processedMedia);
        siteOutputs = siteOutputs == null ? entries : List.copyOf(siteOutputs);
        reasons = reasons == null ? Map.of() : Map.copyOf(reasons);
        changeRevisions = changeRevisions == null ? Map.of() : Map.copyOf(changeRevisions);
    }

    /** A plan without insight whose entries are the whole site. */
    public BuildPlan(
            boolean incremental, long revision, List<PlanEntry> entries, Set<UUID> changedAssets, Set<UUID> processedMedia) {
        this(incremental, revision, entries, changedAssets, processedMedia, null, null, null, null, null);
    }

    /** A plan with no processed media to re-render. */
    public BuildPlan(boolean incremental, long revision, List<PlanEntry> entries, Set<UUID> changedAssets) {
        this(incremental, revision, entries, changedAssets, Set.of());
    }

    /** The same plan rendering only {@code renderable}. */
    public BuildPlan withEntries(List<PlanEntry> renderable) {
        return new BuildPlan(
                incremental, revision, renderable, changedAssets, processedMedia, siteOutputs, reasons, changeRevisions, fallbackCause,
                baselineRevision);
    }

    /** The reason {@code assetUuid} is planned; {@code null} when it isn't. */
    public RebuildReason reasonFor(UUID assetUuid) {
        return reasons.get(assetUuid);
    }

    /** The number of render units in the plan. */
    public int size() {
        return entries.size();
    }
}
