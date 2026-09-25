package com.acme.staticforge.release;

import com.acme.staticforge.asset.content.ContentIssue;
import java.util.List;
import java.util.UUID;

/**
 * The dry run of a release (M27.1.2): what the selection resolves to, which unreleased dependencies it should take
 * along (epic decision 9), and which items are too incomplete to release (epic decision 10).
 */
public record ReleasePlan(
        List<ReleaseTarget> items,
        List<Dependency> dependencies,
        List<Incomplete> incomplete,
        List<String> warnings) {

    /** Why a dependency is proposed. */
    public enum Reason {
        /** The selection references it (an {@code asset_reference} edge of the draft). */
        REFERENCE,
        /** It is an unreleased folder or record set the selection sits in. */
        CONTAINER,
        /** It is an unreleased record of a selected record set. */
        SET_MEMBER,
        /** It is a changed descendant of a selected, changed folder — offered as an optional group. */
        DESCENDANT
    }

    /**
     * A proposed dependency.
     *
     * @param via the asset whose need brought it in
     * @param includedByDefault {@code false} for {@link Reason#DESCENDANT}: offered, not preselected
     */
    public record Dependency(ReleaseTarget target, Reason reason, UUID via, boolean includedByDefault) {}

    /** An item whose version has blocking completeness findings. */
    public record Incomplete(UUID assetUuid, String locale, List<ContentIssue> issues) {}
}
