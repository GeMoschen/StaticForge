package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.content.BodyDefinition;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import java.util.ArrayList;
import java.util.List;

/**
 * The extra CDL restriction a <em>dataset schema</em> is subject to (M19.1.2): a record holds editor
 * values only, so {@code body} declarations — which hold a page's section instances — are rejected
 * with {@code SF-CDL-0108}. Every editor type, catalogs included, stays available: a record's
 * catalog cards render through the page that loops the dataset.
 *
 * <p>An overlay rather than a {@link CdlValidator} rule, like {@link GlobalSetCdlRules}: the save path
 * ({@code DatasetServiceImpl}) and {@code POST /cdl/validate?kind=DATASET} both run it, so the schema
 * editor shows exactly what a save enforces. The compiled definition has no source positions, so
 * the diagnostics report line {@code 0} and name the body instead.
 */
public final class DatasetCdlRules {

    private DatasetCdlRules() {}

    /** Diagnostics for every construct not allowed in a dataset schema; empty when the CDL is fine. */
    public static List<Diagnostic> check(ContentDefinition definition) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        if (definition == null) {
            return diagnostics;
        }
        for (BodyDefinition body : definition.bodies()) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_NOT_ALLOWED_IN_DATASET,
                    "body '" + body.name() + "' is not allowed in a dataset schema: bodies hold page sections,"
                            + " and a record has values only.",
                    0, 0));
        }
        return diagnostics;
    }
}
