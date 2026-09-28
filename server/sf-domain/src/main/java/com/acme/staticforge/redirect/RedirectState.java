package com.acme.staticforge.redirect;

/**
 * What a redirect does against one set of outputs (M30, epic decision 16), computed by {@link RedirectResolver}.
 * Only {@link #ACTIVE} redirects are written to a build; the others stay in the registry.
 */
public enum RedirectState {
    /** Emitted: its source path is free and its target resolves. */
    ACTIVE,
    /** Its source path is a live output (a page or media file now lives there): not emitted, kept. */
    SHADOWED,
    /** Its target page has no output in its channel and locale (unpublished, deleted, other channel): not emitted, kept. */
    DANGLING,
    /** It leads back to its own source path, directly or through other redirects: dropped from the build. */
    LOOP
}
