package com.acme.staticforge.template.diagnostic;

import com.acme.staticforge.template.rules.RuleLevel;

/**
 * Severity of a compile/validation finding. CDL and OCTL diagnostics use {@code ERROR} and {@code WARNING} only; content
 * findings of editor rules (M33) may also be {@code HINT} (shown inline in the editor only) or {@code INFO} (shown
 * everywhere, never counted as a problem).
 */
public enum Severity {
    ERROR,
    WARNING,
    HINT,
    INFO;

    /** The severity a rule level produces. */
    public static Severity of(RuleLevel level) {
        return switch (level) {
            case HINT -> HINT;
            case INFO -> INFO;
            case WARNING -> WARNING;
            case ERROR -> ERROR;
        };
    }
}
