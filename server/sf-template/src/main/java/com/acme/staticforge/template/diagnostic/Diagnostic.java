package com.acme.staticforge.template.diagnostic;

import com.acme.staticforge.template.cdl.CdlSources;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.List;

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
 *
 * <p>{@code pages} (M35.1) are the pages a generation finding is about, at most {@link #MAX_PAGES}: the run diagnostics
 * list them as data next to the message, so a client can link them. Not part of this record's JSON (every other
 * diagnostic API is unchanged); empty for findings that are not about pages.
 */
public record Diagnostic(
        Severity severity, String code, String message, int line, int column, String field,
        @JsonIgnore List<DiagnosticPage> pages) {

    /** How many pages a finding carries (and a run's diagnostics list per code). */
    public static final int MAX_PAGES = 50;

    public Diagnostic {
        if (field == null && CdlSources.isEncodedLine(line)) {
            field = CdlSources.sectionOfLine(line);
            line = CdlSources.localLine(line);
        }
        pages = pages == null ? List.of() : List.copyOf(pages.size() > MAX_PAGES ? pages.subList(0, MAX_PAGES) : pages);
    }

    public Diagnostic(Severity severity, String code, String message, int line, int column, String field) {
        this(severity, code, message, line, column, field, List.of());
    }

    public Diagnostic(Severity severity, String code, String message, int line, int column) {
        this(severity, code, message, line, column, null, List.of());
    }

    public static Diagnostic error(String code, String message, int line, int column) {
        return new Diagnostic(Severity.ERROR, code, message, line, column);
    }

    public static Diagnostic warning(String code, String message, int line, int column) {
        return new Diagnostic(Severity.WARNING, code, message, line, column);
    }

    /** This finding placed in {@code field}, unless it already names one. */
    public Diagnostic inField(String field) {
        return this.field != null ? this : new Diagnostic(severity, code, message, line, column, field, pages);
    }

    /** This finding about {@code pages} (see {@link #pages()}; more than {@link #MAX_PAGES} are cut). */
    public Diagnostic withPages(List<DiagnosticPage> pages) {
        return new Diagnostic(severity, code, message, line, column, field, pages);
    }
}
