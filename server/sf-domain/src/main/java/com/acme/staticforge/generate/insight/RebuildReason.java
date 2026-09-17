package com.acme.staticforge.generate.insight;

import java.util.List;
import java.util.UUID;

/**
 * Why an asset's outputs are in a build plan (M22.1.1): a root kind and, for a change-driven root, the shortest chain
 * of dependencies from the planned asset back to the change.
 *
 * <p>{@code steps} is ordered from the planned asset towards the root and excludes the root: a changed page is its own
 * root with no steps; {@code page:about ← section_template:teaser ← media:hero} is two steps (the page, via
 * {@code SECTION_TEMPLATE}; the section, via a {@code MEDIA_REF} reference) and the root {@code media:hero}.
 *
 * @param rootUuid the root asset (the change, the explicitly scoped asset, or the planned asset itself); {@code null}
 *     for a FULL build
 * @param rootRevision the revision the root changed in (change-driven roots only)
 * @param causeCount how many distinct changed roots reach the planned asset; {@code 1} for other root kinds
 * @param fallbackCause set for {@link RebuildRootKind#INCREMENTAL_FALLBACK_FULL}
 */
public record RebuildReason(
        RebuildRootKind rootKind,
        UUID rootUuid,
        String rootType,
        String rootUid,
        Long rootRevision,
        int causeCount,
        FallbackCause fallbackCause,
        List<RebuildStep> steps) {

    public RebuildReason {
        steps = steps == null ? List.of() : List.copyOf(steps);
        causeCount = Math.max(causeCount, 1);
    }

    /** A root without a chain: FULL, fallback, explicit scope or a base build gap. */
    public static RebuildReason of(RebuildRootKind kind, FallbackCause cause, UUID rootUuid, String rootType, String rootUid) {
        return new RebuildReason(kind, rootUuid, rootType, rootUid, null, 1, cause, List.of());
    }

    /** The edge by which the planned asset depends on the next asset of the chain; {@code null} for a chain of length 0. */
    public RebuildEdgeKind firstEdge() {
        return steps.isEmpty() ? null : steps.get(0).edge();
    }
}
