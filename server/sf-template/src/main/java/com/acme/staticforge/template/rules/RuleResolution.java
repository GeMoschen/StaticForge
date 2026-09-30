package com.acme.staticforge.template.rules;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.expression.CompiledExpression;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * The rule checks that need the definition's editors (M33.2): every rule, state and fill target, and every identifier
 * an expression reads, must name an editor — or one of the named roots the rule engine provides — else
 * {@code SF-CDL-0115}. Run against the <em>effective</em> definition, so a child template's rules may target
 * inherited editors: by {@code EffectiveDefinition.merge} for templates, standalone for datasets and property sets.
 */
public final class RuleResolution {

    /** The roots the rule engine puts in every expression's scope (epic decision 4). */
    public static final Set<String> NAMED_ROOTS = Set.of(
            "value", "item", "index", "parent", "locale", "defaultLocale", "page", "record", "global", "section",
            "release", "body");

    /** The roots only a rule on list rows has. */
    private static final Set<String> ROW_ROOTS = Set.of("item", "index", "parent");

    private RuleResolution() {}

    /**
     * {@code SF-CDL-0115} for each target or identifier of {@code rules} that {@code definition}'s editors can't
     * resolve, and {@code SF-CDL-0117} for a cycle among {@code allFills} that one of {@code rules}' fills is part of.
     *
     * @param rules the entries to check (a template's own layer)
     * @param definition the editors they may name (the effective definition)
     * @param allFills the effective fills (own and inherited), for the cycle check
     */
    public static List<Diagnostic> check(RuleSet rules, ContentDefinition definition, RuleSet allFills) {
        List<Diagnostic> out = new ArrayList<>();
        if (rules == null || rules.isEmpty()) {
            return out;
        }
        for (RuleDefinition rule : rules.rules()) {
            String what = "Rule '" + rule.name() + "'";
            checkTarget(rule.target(), what, rule.line(), rule.column(), definition, out);
            checkIdentifiers(rule.assertion(), rule.target(), what, rule.line(), rule.column(), definition, out);
            checkIdentifiers(rule.when(), rule.target(), what, rule.line(), rule.column(), definition, out);
        }
        for (StateDefinition state : rules.states()) {
            String what = "The state of '" + state.target().text() + "'";
            checkTarget(state.target(), what, state.line(), state.column(), definition, out);
            checkIdentifiers(state.requiredWhen(), state.target(), what, state.line(), state.column(), definition, out);
            checkIdentifiers(state.readOnlyWhen(), state.target(), what, state.line(), state.column(), definition, out);
        }
        for (FillDefinition fill : rules.fills()) {
            String what = "The fill of '" + fill.target().text() + "'";
            checkTarget(fill.target(), what, fill.line(), fill.column(), definition, out);
            checkIdentifiers(fill.value(), fill.target(), what, fill.line(), fill.column(), definition, out);
        }
        RuleSet merged = allFills == null ? rules : allFills;
        List<String> cycle = merged.fillCycle();
        if (!cycle.isEmpty()) {
            rules.fills().stream()
                    .filter(f -> cycle.contains(f.target().text()))
                    .findFirst()
                    .ifPresent(f -> out.add(Diagnostic.error(
                            DiagnosticCodes.CDL_RULE_DUPLICATE,
                            "The fills form a cycle: " + String.join(" → ", cycle), f.line(), f.column())));
        }
        return out;
    }

    /**
     * {@code SF-CDL-0113} for each whole-definition target whose keyword doesn't match the definition's kind: a page
     * template's rules write {@code on page}, a section template's {@code on section}, a dataset schema's
     * {@code on record}, a property set's {@code on global}.
     */
    public static List<Diagnostic> checkKind(RuleSet rules, String keyword) {
        List<Diagnostic> out = new ArrayList<>();
        if (rules == null) {
            return out;
        }
        for (RuleDefinition rule : rules.rules()) {
            String written = rule.target().whole();
            if (written != null && !written.isEmpty() && !written.equals(keyword)) {
                out.add(Diagnostic.error(
                        DiagnosticCodes.CDL_RULE_INVALID,
                        "Rule '" + rule.name() + "' is 'on " + written + "', but this definition is a " + keyword
                                + "; write 'on " + keyword + "' for the whole definition",
                        rule.line(), rule.column()));
            }
        }
        return out;
    }

    private static void checkTarget(
            RulePath target, String what, int line, int column, ContentDefinition definition, List<Diagnostic> out) {
        if (target == null || target.isWhole()) {
            return;
        }
        String problem = resolve(target.segments(), definition.editors());
        if (problem != null) {
            out.add(Diagnostic.error(
                    DiagnosticCodes.CDL_RULE_UNKNOWN_PATH, what + ": target '" + target.text() + "' " + problem, line, column));
        }
    }

    /** {@code null} when the path names an editor, else what is wrong. */
    private static String resolve(List<RulePath.Segment> segments, List<EditorDefinition> namespace) {
        List<EditorDefinition> scope = namespace;
        for (int i = 0; i < segments.size(); i++) {
            RulePath.Segment segment = segments.get(i);
            EditorDefinition editor = find(scope, segment.name());
            if (editor == null) {
                return "names no editor ('" + segment.name() + "' is unknown)";
            }
            if (segment.rows() && editor.type() != EditorType.LIST) {
                return "iterates '" + segment.name() + "[]', which is not a list";
            }
            if (i == segments.size() - 1) {
                return null;
            }
            if (editor.isList() && !segment.rows()) {
                return "reads into list '" + segment.name() + "' without [] — write " + segment.name() + "[] for its rows";
            }
            if (!editor.isList() && !editor.isGroup()) {
                return "reads into '" + segment.name() + "', which has no fields";
            }
            scope = editor.items();
        }
        return null;
    }

    /** An editor by name in a namespace; groups are transparent, a list's items are not. */
    private static EditorDefinition find(List<EditorDefinition> namespace, String name) {
        for (EditorDefinition editor : namespace) {
            if (editor.name().equals(name)) {
                return editor;
            }
            if (editor.isGroup()) {
                EditorDefinition inner = find(editor.items(), name);
                if (inner != null) {
                    return inner;
                }
            }
        }
        return null;
    }

    private static void checkIdentifiers(
            CompiledExpression expression,
            RulePath target,
            String what,
            int line,
            int column,
            ContentDefinition definition,
            List<Diagnostic> out) {
        if (expression == null) {
            return;
        }
        for (String identifier : expression.identifiers()) {
            if (identifier.startsWith("global:")) {
                continue;
            }
            String root = identifier.contains(".") ? identifier.substring(0, identifier.indexOf('.')) : identifier;
            if (ROW_ROOTS.contains(root) && (target == null || !target.hasRows())) {
                out.add(Diagnostic.error(
                        DiagnosticCodes.CDL_RULE_UNKNOWN_PATH,
                        what + " reads '" + root + "', which only a rule on list rows (on list[]) has", line, column));
                continue;
            }
            if (NAMED_ROOTS.contains(root) || find(definition.editors(), root) != null) {
                continue;
            }
            out.add(Diagnostic.error(
                    DiagnosticCodes.CDL_RULE_UNKNOWN_PATH,
                    what + " reads '" + identifier + "', but no editor is named '" + root + "'", line, column));
        }
    }
}
