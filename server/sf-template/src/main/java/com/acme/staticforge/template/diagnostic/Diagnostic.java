package com.acme.staticforge.template.diagnostic;

/**
 * A compile/validation finding returned to the UI for Monaco squiggles (spec §14.7,
 * §16.11). {@code line}/{@code column} are 1-based; {@code column} is 0 when unknown.
 */
public record Diagnostic(Severity severity, String code, String message, int line, int column) {

    public static Diagnostic error(String code, String message, int line, int column) {
        return new Diagnostic(Severity.ERROR, code, message, line, column);
    }

    public static Diagnostic warning(String code, String message, int line, int column) {
        return new Diagnostic(Severity.WARNING, code, message, line, column);
    }
}
