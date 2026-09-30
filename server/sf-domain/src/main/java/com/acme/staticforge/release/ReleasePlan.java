package com.acme.staticforge.release;

import com.acme.staticforge.asset.content.ContentIssue;
import java.util.List;
import java.util.UUID;

/**
 * The dry run of a release (M27.1.2): what the selection resolves to, which unreleased dependencies it should take
 * along (epic decision 9), and which items are too incomplete to release (epic decision 10). M33.6 adds the rule
 * findings that need accepting ({@code warningFindings}), those that inform ({@code infoFindings}) and the values the
 * release fills would write ({@code fills}).
 */
public record ReleasePlan(
        List<ReleaseTarget> items,
        List<Dependency> dependencies,
        List<Incomplete> incomplete,
        List<String> warnings,
        List<Incomplete> warningFindings,
        List<Incomplete> infoFindings,
        List<PlannedFill> fills) {

    public ReleasePlan(
            List<ReleaseTarget> items, List<Dependency> dependencies, List<Incomplete> incomplete, List<String> warnings) {
        this(items, dependencies, incomplete, warnings, List.of(), List.of(), List.of());
    }

    /**
     * A value a {@code release} fill would write (M33.6): the release stores it as a new draft version and releases
     * that. {@code locale} is set for a language-dependent field.
     */
    public record PlannedFill(UUID assetUuid, String locale, String path, com.fasterxml.jackson.databind.JsonNode value) {}

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

    /** An item of the release and its findings of one level: blocking ({@code incomplete}), warnings or infos. */
    public record Incomplete(UUID assetUuid, String locale, List<ContentIssue> issues) {}
}
