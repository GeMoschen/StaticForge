package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.content.BodyDefinition;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import java.util.ArrayList;
import java.util.List;

/**
 * The extra CDL restrictions a <em>global property set</em> is subject to (M17.1.2). A set is a
 * value container with no page around it, so two constructs the CDL grammar otherwise allows make
 * no sense in one and are rejected with {@code SF-CDL-0107}:
 *
 * <ul>
 *   <li>{@code body} declarations — a body holds section instances belonging to a page, and a set
 *       has no page to belong to;
 *   <li>{@code catalog} editors — a catalog card renders through the current page's block
 *       resolver, which a set is never read with.
 * </ul>
 *
 * <p>Kept out of {@link CdlValidator} on purpose: the same CDL is perfectly valid for a template,
 * so this is a caller-chosen overlay rather than a language rule. Both the save path
 * ({@code GlobalSetServiceImpl}) and {@code POST /cdl/validate?kind=GLOBAL_SET} run it, so the
 * editor sees while typing exactly what the server enforces on save.
 *
 * <p>The compiled {@link ContentDefinition} carries no source positions, so the diagnostics report
 * line {@code 0}; each message names the offending declaration instead.
 */
public final class GlobalSetCdlRules {

    private GlobalSetCdlRules() {}

    /** Diagnostics for every construct not allowed in a property set; empty when the CDL is fine. */
    public static List<Diagnostic> check(ContentDefinition definition) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        if (definition == null) {
            return diagnostics;
        }
        for (BodyDefinition body : definition.bodies()) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_NOT_ALLOWED_IN_GLOBAL_SET,
                    "body '" + body.name() + "' is not allowed in a global property set: a body holds "
                            + "page sections, and a property set has no page.",
                    0, 0));
        }
        checkEditors(definition.editors(), diagnostics);
        diagnostics.addAll(PaginationCdlRules.notAllowedIn(definition, "a global property set"));
        return diagnostics;
    }

    private static void checkEditors(List<EditorDefinition> editors, List<Diagnostic> diagnostics) {
        for (EditorDefinition editor : editors) {
            if (editor.type() == EditorType.CATALOG) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.CDL_NOT_ALLOWED_IN_GLOBAL_SET,
                        "editor catalog '" + editor.name() + "' is not allowed in a global property set: "
                                + "catalog cards render through the current page, which a property set has none of.",
                        0, 0));
            }
            checkEditors(editor.items(), diagnostics);
        }
    }
}
