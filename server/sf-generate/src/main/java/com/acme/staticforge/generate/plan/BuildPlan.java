package com.acme.staticforge.generate.plan;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The result of build planning (spec §18.3): an ordered list of render units plus the set of
 * asset UUIDs known to have changed since the last successful run (drives incremental
 * planning and the dependency re-sync). An empty {@code entries} list is a valid, successful
 * build (nothing to render).
 */
public record BuildPlan(boolean incremental, long revision, List<PlanEntry> entries, Set<UUID> changedAssets) {

    public BuildPlan {
        entries = entries == null ? List.of() : List.copyOf(entries);
        changedAssets = changedAssets == null ? Set.of() : Set.copyOf(changedAssets);
    }

    /** The number of render units in the plan. */
    public int size() {
        return entries.size();
    }
}
