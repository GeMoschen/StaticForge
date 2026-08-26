package com.acme.staticforge.asset.folder;

/**
 * What kind of child a navigation folder's {@link StartNode} points at (spec §17, `M8.1.2`).
 * Distinct from {@code PageReferenceTarget}'s kind: this one stays inside the navigation
 * tree itself (a child of the same folder), never the page store.
 */
public enum StartNodeKind {
    PAGE_REFERENCE,
    FOLDER
}
