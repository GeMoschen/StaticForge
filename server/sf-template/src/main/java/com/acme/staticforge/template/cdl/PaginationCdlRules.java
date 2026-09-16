package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import java.util.ArrayList;
import java.util.List;

/**
 * Where a {@code pagination} editor may not be declared (M21.1.1): it paginates a page, so a definition without a
 * page of its own — a section template, a global property set, a dataset schema — rejects it with
 * {@code SF-CDL-0110}. An overlay like {@link GlobalSetCdlRules}: the CDL itself is valid, the holder decides. The
 * compiled definition carries no positions, so the diagnostics report line {@code 0} and name the editor.
 */
public final class PaginationCdlRules {

    private PaginationCdlRules() {}

    /**
     * One {@code SF-CDL-0110} per pagination editor anywhere in {@code definition}.
     *
     * @param holder what the definition belongs to, for the message ("a section template")
     */
    public static List<Diagnostic> notAllowedIn(ContentDefinition definition, String holder) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        if (definition != null) {
            collect(definition.editors(), holder, diagnostics);
        }
        return diagnostics;
    }

    private static void collect(List<EditorDefinition> editors, String holder, List<Diagnostic> diagnostics) {
        for (EditorDefinition editor : editors) {
            if (editor.isPagination()) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.CDL_PAGINATION_PLACEMENT,
                        "editor pagination '" + editor.name() + "' is not allowed in " + holder
                                + ": pagination belongs to a page template.",
                        0, 0));
            }
            collect(editor.items(), holder, diagnostics);
        }
    }
}
