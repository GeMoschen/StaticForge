package com.acme.staticforge.generate.snapshot;

/**
 * Which state of editorial content a {@link Snapshot} renders (M27.2.1, epic decision 16).
 *
 * <p>Live types — templates, dataset schemas, template-store folders — render their version at the snapshot revision
 * in both views; the views differ only for releasable assets ({@code ReleasableTypes}).
 */
public enum SnapshotView {

    /**
     * What a build publishes: per locale, the version the release pointer valid at the revision names. An asset not
     * released in a locale is absent there, like a tombstone ({@link SnapshotAsset#unreleased()}).
     */
    RELEASED,

    /** Every asset at its version valid at the revision, in every locale — the drafts, as a preview shows them. */
    DRAFT
}
