package com.acme.staticforge.exportimport;

/**
 * What an import does with the release state an archive carries (M27.5.1, epic decision 28).
 *
 * <p>An archive of protocol {@code <= 7} has no release state and always imports as {@link #DRAFT}.
 */
public enum ReleaseMode {
    /** Every asset is released in the locales it was released in when it was exported, at the version it was released at. */
    KEEP,
    /** Nothing is released: every newly imported asset is {@code NEW}; an overwritten asset keeps the target's release state. */
    DRAFT
}
