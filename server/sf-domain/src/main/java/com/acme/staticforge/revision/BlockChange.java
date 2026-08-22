package com.acme.staticforge.revision;

/**
 * A single block-level change within a rich-text field (spec §7.6). Rich text is stored as
 * {@code {"format":"html","value":"<p>…</p><h2>…</h2>"}}; rather than treating the whole HTML
 * document as one opaque leaf, the differ splits it into blocks and reports the per-block
 * difference so the UI can render additions/removals.
 *
 * <p>{@code kind} is one of {@code ADD}, {@code REMOVE} or {@code UPDATE}. {@code index} is the
 * zero-based block position: for {@code ADD}/{@code UPDATE} it is the position in the new
 * document, for {@code REMOVE} it is the position in the old document. {@code before}/{@code
 * after} are the HTML of a single block (never both null); {@code ADD} sets only {@code after},
 * {@code REMOVE} only {@code before}.
 */
public record BlockChange(int index, String kind, String before, String after) {

    public static final String ADD = "ADD";
    public static final String REMOVE = "REMOVE";
    public static final String UPDATE = "UPDATE";
}
