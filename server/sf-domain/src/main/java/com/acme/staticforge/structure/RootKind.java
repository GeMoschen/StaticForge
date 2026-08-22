package com.acme.staticforge.structure;

/** The kind of reference a structure's root points at (spec §17.1). */
public enum RootKind {
    /** {@code root page:home} — a single page by UID. */
    PAGE,
    /** {@code root folder:/products/} — every page in a folder subtree. */
    FOLDER
}
