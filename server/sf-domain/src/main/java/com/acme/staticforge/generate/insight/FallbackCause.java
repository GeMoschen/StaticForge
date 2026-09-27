package com.acme.staticforge.generate.insight;

/**
 * Why an INCREMENTAL request was planned as a FULL build (M22.4.1). Stored and served by name; an unknown name reads
 * as {@link #UNKNOWN}.
 */
public enum FallbackCause {
    /** The target has no current build, or its current build doesn't cover every requested channel. */
    NO_COMPLETE_BUILD_FOR_TARGET,
    /** The target's current build is gone, or was published before builds recorded a manifest. */
    BASE_BUILD_MISSING,
    /** A channel's output settings changed since the baseline: every page of that channel may have moved. */
    CHANNEL_SETTINGS_CHANGED,
    /** The requested revision is older than the baseline, so changes since the baseline can't describe it. */
    REVISION_BEFORE_BASELINE,
    /**
     * The target's current build was published without the quality check facts (before M30, M30.1.3): carried outputs
     * could not be checked, so every output is checked again.
     */
    BASE_BUILD_WITHOUT_QUALITY_FACTS,
    /** The project's quality rule configuration (or the rule set) changed since the baseline: every output is checked again. */
    QUALITY_RULES_CHANGED,
    UNKNOWN;

    /** The cause named {@code name}; {@code null} for {@code null}, {@link #UNKNOWN} for a name this build doesn't know. */
    public static FallbackCause parse(String name) {
        return name == null ? null : InsightNames.parse(FallbackCause.class, name, UNKNOWN);
    }
}
