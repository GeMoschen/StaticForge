package com.acme.staticforge.template.render;

/**
 * The escaping mode for a channel's {@code default_escaping} (spec §16.1, §16.3). Applied as
 * the final step of a filter chain unless the chain already contains an escaping filter
 * ({@code html}/{@code attr}/{@code js}/{@code url}) or {@code raw}.
 */
public enum Escaping {
    /** Escape {@code & < > " '} for safe HTML text insertion. */
    HTML,
    /** No implicit escaping: markdown source is emitted as-is and rendered later. */
    MARKDOWN,
    /** No implicit escaping. */
    NONE
}
