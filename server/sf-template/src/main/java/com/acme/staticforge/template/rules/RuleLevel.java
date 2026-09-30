package com.acme.staticforge.template.rules;

import java.util.Locale;

/**
 * How severe a rule finding is (M33, user decision 3). {@code HINT} shows only inline in the editor; {@code INFO} shows
 * everywhere but is not counted as a problem; {@code WARNING} and {@code ERROR} as before — only an {@code ERROR} blocks
 * the action of a scope it runs in.
 */
public enum RuleLevel {
    HINT,
    INFO,
    WARNING,
    ERROR;

    /** The CDL keyword ({@code hint}, {@code info}, {@code warning}, {@code error}). */
    public String keyword() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** The level named by a CDL keyword, or {@code null}. */
    public static RuleLevel fromKeyword(String keyword) {
        for (RuleLevel level : values()) {
            if (level.keyword().equals(keyword)) {
                return level;
            }
        }
        return null;
    }
}
