package com.acme.staticforge.structure;

/** How a structure expands its matched pages into a tree (spec §17.2). */
public enum ExpandMode {
    /** Nest every page under its folder-path parent, recursively, down to {@code depth}. */
    ALL,
    /** Flatten to an ordered list; only the chain leading to the active page is nested. */
    ACTIVE_PATH_ONLY,
    /** A fully flat ordered list with no children. */
    NONE
}
