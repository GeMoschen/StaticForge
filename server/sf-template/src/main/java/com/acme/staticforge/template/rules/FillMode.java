package com.acme.staticforge.template.rules;

/**
 * Whether a fill overwrites (M33, user decision 8): {@code EMPTY} writes only into an empty field; {@code ALWAYS}
 * computes the field every time, which makes it read-only in the editor.
 */
public enum FillMode {
    EMPTY,
    ALWAYS;

    /** The mode named by a CDL keyword ({@code empty}, {@code always}), or {@code null}. */
    public static FillMode fromKeyword(String keyword) {
        return switch (keyword) {
            case "empty" -> EMPTY;
            case "always" -> ALWAYS;
            default -> null;
        };
    }
}
