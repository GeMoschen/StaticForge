package com.acme.staticforge.template.query;

import com.acme.staticforge.template.diagnostic.Severity;

/**
 * One finding about a record set's stored query (M25.1.2): which part of the query it concerns and where
 * inside that part, so an editor can mark the right input.
 *
 * @param field the query part: {@code where}, {@code sort}, {@code limit} or {@code offset}
 * @param code {@code SF-TPL-0140} (malformed, or reads the render scope), {@code SF-TPL-0141} (a field the
 *     dataset does not declare) or {@code SF-TPL-0142} (a sort field without a natural order)
 * @param line 1-based line inside the field's text ({@code 0} for {@code limit}/{@code offset})
 * @param column 1-based column inside the field's text, {@code 0} when unknown
 */
public record RecordSetQueryDiagnostic(
        String field, Severity severity, String code, String message, int line, int column) {

    static RecordSetQueryDiagnostic error(String field, String code, String message, int column) {
        return new RecordSetQueryDiagnostic(field, Severity.ERROR, code, message, column == 0 ? 0 : 1, column);
    }
}
