package com.acme.staticforge.template.diagnostic;

import com.acme.staticforge.template.cdl.CdlSources;

/**
 * A compile/validation finding returned to the UI for editor squiggles (spec §14.7,
 * §16.11). {@code line}/{@code column} are 1-based; {@code column} is 0 when unknown.
 *
 * <p>{@code field} (M34) names the source the position is in when a holder is edited as several sources:
 * {@code content}, {@code bodies} or {@code rules} for a CDL section, {@code channel:<key>} for a channel template;
 * {@code null} when there is only one source or the finding has no position. A CDL section compiled from
 * {@link CdlSources} encodes its section in the line ({@link CdlSources#encodeLine}); this constructor decodes it, so
 * every diagnostic built from such a position — by the parser, the validator or a later rule check — carries its
 * section and a line relative to it.
 */
public record Diagnostic(Severity severity, String code, String message, int line, int column, String field) {

    public Diagnostic {
        if (field == null && CdlSources.isEncodedLine(line)) {
            field = CdlSources.sectionOfLine(line);
            line = CdlSources.localLine(line);
        }
    }

    public Diagnostic(Severity severity, String code, String message, int line, int column) {
        this(severity, code, message, line, column, null);
    }

    public static Diagnostic error(String code, String message, int line, int column) {
        return new Diagnostic(Severity.ERROR, code, message, line, column);
    }

    public static Diagnostic warning(String code, String message, int line, int column) {
        return new Diagnostic(Severity.WARNING, code, message, line, column);
    }

    /** This finding placed in {@code field}, unless it already names one. */
    public Diagnostic inField(String field) {
        return this.field != null ? this : new Diagnostic(severity, code, message, line, column, field);
    }
}
