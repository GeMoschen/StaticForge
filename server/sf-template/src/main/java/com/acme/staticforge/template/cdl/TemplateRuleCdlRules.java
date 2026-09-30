package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.rules.RuleResolution;
import java.util.ArrayList;
import java.util.List;

/**
 * The rule checks of a template's CDL (M33.2) that the plain compile can't do. A section template has no inheritance,
 * so its rules resolve against its own editors and whole-definition rules say {@code on section}. A page template's
 * rules resolve against its <em>effective</em> definition when its channels compile ({@code EffectiveDefinition.merge});
 * here only the {@code on page} keyword is checked — or, for the live editor check that doesn't know the chain, the
 * names too, with unknown names as warnings since they may be inherited.
 */
public final class TemplateRuleCdlRules {

    private TemplateRuleCdlRules() {}

    /** A section template: names resolved against its own editors, {@code on section}. */
    public static List<Diagnostic> sectionTemplate(ContentDefinition definition) {
        List<Diagnostic> out = new ArrayList<>(RuleResolution.check(definition.rules(), definition, definition.rules()));
        out.addAll(RuleResolution.checkKind(definition.rules(), "section"));
        return out;
    }

    /** A page template on save: {@code on page}; names are checked with the chain. */
    public static List<Diagnostic> pageTemplate(ContentDefinition definition) {
        return RuleResolution.checkKind(definition.rules(), "page");
    }

    /**
     * A page template in the live CDL check, which doesn't know the template's ancestors: names are resolved against
     * the source's own editors, and a name that doesn't resolve is a warning — it may be inherited, which the save
     * checks against the whole chain.
     */
    public static List<Diagnostic> pageTemplateWithoutChain(ContentDefinition definition) {
        List<Diagnostic> out = new ArrayList<>();
        for (Diagnostic d : RuleResolution.check(definition.rules(), definition, definition.rules())) {
            out.add(DiagnosticCodes.CDL_RULE_UNKNOWN_PATH.equals(d.code())
                    ? new Diagnostic(Severity.WARNING, d.code(),
                            d.message() + " — fine if a parent template declares it", d.line(), d.column())
                    : d);
        }
        out.addAll(pageTemplate(definition));
        return out;
    }
}
