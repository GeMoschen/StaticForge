package com.acme.staticforge.generate.plan;

import java.util.List;
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
 */
public record BuildPlan(
        boolean incremental, long revision, List<PlanEntry> entries, Set<UUID> changedAssets, Set<UUID> processedMedia) {

    public BuildPlan {
        entries = entries == null ? List.of() : List.copyOf(entries);
        changedAssets = changedAssets == null ? Set.of() : Set.copyOf(changedAssets);
        processedMedia = processedMedia == null ? Set.of() : Set.copyOf(processedMedia);
    }

    /** A plan with no processed media to re-render. */
    public BuildPlan(boolean incremental, long revision, List<PlanEntry> entries, Set<UUID> changedAssets) {
        this(incremental, revision, entries, changedAssets, Set.of());
    }

    /** The number of render units in the plan. */
    public int size() {
        return entries.size();
    }
}
