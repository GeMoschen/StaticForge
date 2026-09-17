package com.acme.staticforge.generate.insight;

/**
 * Why a plan entry is in a build (M22.1.1): the root its {@link RebuildReason} chain ends at. Stored and served by name;
 * a name this build doesn't know (a plan written by a newer build) reads as {@link #UNKNOWN}.
 */
public enum RebuildRootKind {
    /** A FULL build renders every page. */
    FULL_BUILD,
    /** INCREMENTAL was requested, but there was no usable baseline; the plan's {@link FallbackCause} says why. */
    INCREMENTAL_FALLBACK_FULL,
    /** The asset was listed explicitly in the request's {@code assetUuids}. */
    EXPLICIT_SCOPE,
    /** The root asset changed since the baseline. */
    ASSET_CHANGED,
    /** The root asset was deleted since the baseline. */
    ASSET_DELETED,
    /** Nothing it depends on changed, but the base build lacks this output (e.g. the page was held back then). */
    NOT_IN_BASE_BUILD,
    UNKNOWN;

    /** The kind named {@code name}; {@link #UNKNOWN} for {@code null} or a name this build doesn't know. */
    public static RebuildRootKind parse(String name) {
        return InsightNames.parse(RebuildRootKind.class, name, UNKNOWN);
    }

    /** Whether reasons of this kind start at a change and carry a chain. */
    public boolean changeDriven() {
        return this == ASSET_CHANGED || this == ASSET_DELETED;
    }
}
