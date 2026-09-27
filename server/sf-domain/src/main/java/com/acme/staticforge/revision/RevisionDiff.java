package com.acme.staticforge.revision;

import java.util.List;

/**
 * Structural diff of all touched assets in a revision against the previous one.
 *
 * @param compacted revision compaction absorbed exact changes of this revision (M29.4.3): the revision is flagged
 *     {@code compacted}, or some asset's diff is (see {@link AssetDiff#compacted()})
 * @param message why the diff is incomplete when {@code compacted} ({@link #COMPACTED_MESSAGE}); {@code null} otherwise
 */
public record RevisionDiff(long projectId, long revisionId, List<AssetDiff> assets, boolean compacted, String message) {

    public static final String COMPACTED_MESSAGE =
            "Exact changes of this revision were compacted; the state at the end of the day is kept";

    /** The diff of a revision without compacted history. */
    public RevisionDiff(long projectId, long revisionId, List<AssetDiff> assets) {
        this(projectId, revisionId, assets, false, null);
    }
}
