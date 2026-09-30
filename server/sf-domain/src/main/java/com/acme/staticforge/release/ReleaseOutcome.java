package com.acme.staticforge.release;

import java.util.List;

/**
 * What a release, unpublish or discard did (M27.1.2).
 *
 * @param revision the revision it recorded, or {@code null} when every item was a no-op
 * @param applied the (asset, locale) pairs it changed
 * @param skipped the pairs that needed nothing (already published, already unpublished)
 * @param warnings release only: the rule warnings the caller accepted (M33.6), per released item
 * @param sharedFieldsKept discard only: pairs whose locale was restored while the shared, non-localizable values stayed
 *     as drafted because another locale still has unreleased changes (epic decision 11)
 */
public record ReleaseOutcome(
        Long revision,
        List<ReleaseTarget> applied,
        List<ReleaseTarget> skipped,
        List<ReleaseTarget> sharedFieldsKept,
        List<ReleasePlan.Incomplete> warnings) {

    public ReleaseOutcome {
        applied = List.copyOf(applied);
        skipped = List.copyOf(skipped);
        sharedFieldsKept = List.copyOf(sharedFieldsKept);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }

    public ReleaseOutcome(
            Long revision, List<ReleaseTarget> applied, List<ReleaseTarget> skipped, List<ReleaseTarget> sharedFieldsKept) {
        this(revision, applied, skipped, sharedFieldsKept, List.of());
    }
}
