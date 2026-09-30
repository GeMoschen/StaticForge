package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.cdl.CdlParser.EditorNode;
import com.acme.staticforge.template.cdl.CdlParser.ModifierNode;
import com.acme.staticforge.template.cdl.CdlParser.RuleAttr;
import com.acme.staticforge.template.cdl.CdlParser.RuleEntryNode;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.expression.CompiledExpression;
import com.acme.staticforge.template.expression.ExpressionCompiler;
import com.acme.staticforge.template.expression.ExpressionError;
import com.acme.staticforge.template.rules.BuiltinRule;
import com.acme.staticforge.template.rules.FillDefinition;
import com.acme.staticforge.template.rules.FillMode;
import com.acme.staticforge.template.rules.LocaleSelector;
import com.acme.staticforge.template.rules.OnGeneration;
import com.acme.staticforge.template.rules.RuleDefinition;
import com.acme.staticforge.template.rules.RuleLevel;
import com.acme.staticforge.template.rules.RuleMessages;
import com.acme.staticforge.template.rules.RulePath;
import com.acme.staticforge.template.rules.RuleScope;
import com.acme.staticforge.template.rules.RuleSet;
import com.acme.staticforge.template.rules.StateDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Compiles a CDL source's {@code rules {}} entries and built-in modifiers (M33.2) and reports everything that can be
 * judged from the source alone: entry syntax and keyword values ({@code SF-CDL-0113}), missing keys ({@code 0114}),
 * expressions ({@code 0116}), duplicates and fill cycles ({@code 0117}), and modifiers ({@code 0119}). Whether targets
 * and identifiers name editors ({@code 0115}) and whether an {@code off} names an inherited rule ({@code 0118}) depend
 * on the inheritance chain; {@link RuleResolution} checks those.
 */
final class RulesCompiler {

    /** The defaults of a built-in completeness rule (epic decision 2). */
    static final RuleLevel BUILTIN_LEVEL = RuleLevel.ERROR;

    static final Set<RuleScope> BUILTIN_SCOPES = Set.of(RuleScope.EDIT, RuleScope.RELEASE, RuleScope.GENERATION);

    private static final Set<RuleScope> FILL_SCOPES = Set.of(RuleScope.EDIT, RuleScope.SAVE, RuleScope.RELEASE);

    private RulesCompiler() {}

    static RuleSet compile(List<RuleEntryNode> entries, List<Diagnostic> diagnostics) {
        List<RuleDefinition> rules = new ArrayList<>();
        List<StateDefinition> states = new ArrayList<>();
        List<FillDefinition> fills = new ArrayList<>();
        Set<String> off = new LinkedHashSet<>();
        Set<String> ruleNames = new HashSet<>();
        Set<String> statePaths = new HashSet<>();
        Set<String> fillPaths = new HashSet<>();
        for (RuleEntryNode entry : entries) {
            switch (entry.kind) {
                case "rule" -> {
                    if (entry.name == null || entry.name.isBlank()) {
                        error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID, "A rule needs a name", entry.line, entry.column);
                        continue;
                    }
                    if (BuiltinRule.NAMES.contains(entry.name)) {
                        error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID_MODIFIER,
                                "'" + entry.name + "' is a built-in check: change its level or scope on the editor's"
                                        + " attribute (e.g. " + entry.name + " level warning), not in rules {}",
                                entry.line, entry.column);
                        continue;
                    }
                    if (!ruleNames.add(entry.name)) {
                        error(diagnostics, DiagnosticCodes.CDL_RULE_DUPLICATE,
                                "Rule '" + entry.name + "' is declared twice", entry.line, entry.column);
                        continue;
                    }
                    if (entry.off) {
                        off.add(entry.name);
                    } else {
                        RuleDefinition rule = rule(entry, diagnostics);
                        if (rule != null) {
                            rules.add(rule);
                        }
                    }
                }
                case "state" -> {
                    StateDefinition state = state(entry, diagnostics);
                    if (state != null) {
                        if (!statePaths.add(state.target().text())) {
                            error(diagnostics, DiagnosticCodes.CDL_RULE_DUPLICATE,
                                    "A second state for '" + state.target().text() + "': merge them into one",
                                    entry.line, entry.column);
                        } else {
                            states.add(state);
                        }
                    }
                }
                default -> {
                    FillDefinition fill = fill(entry, diagnostics);
                    if (fill != null) {
                        if (!fillPaths.add(fill.target().text())) {
                            error(diagnostics, DiagnosticCodes.CDL_RULE_DUPLICATE,
                                    "A second fill for '" + fill.target().text() + "': a field has one fill",
                                    entry.line, entry.column);
                        } else {
                            fills.add(fill);
                        }
                    }
                }
            }
        }
        RuleSet set = new RuleSet(rules, states, fills, off);
        List<String> cycle = set.fillCycle();
        if (!cycle.isEmpty()) {
            FillDefinition first = fills.stream()
                    .filter(f -> f.target().text().equals(cycle.get(0)))
                    .findFirst()
                    .orElse(fills.get(0));
            error(diagnostics, DiagnosticCodes.CDL_RULE_DUPLICATE,
                    "The fills form a cycle: " + String.join(" → ", cycle), first.line(), first.column());
        }
        return set;
    }

    // ------------------------------------------------------------------

    private static RuleDefinition rule(RuleEntryNode entry, List<Diagnostic> diagnostics) {
        String what = "Rule '" + entry.name + "'";
        RulePath target = target(entry, true, diagnostics);
        RuleLevel level = level(entry, what, diagnostics);
        Set<RuleScope> scopes = scopes(entry, "scope", what, EnumSet.allOf(RuleScope.class), diagnostics);
        CompiledExpression assertion = expression(entry, "assert", what, true, diagnostics);
        CompiledExpression when = expression(entry, "when", what, false, diagnostics);
        RuleMessages messages = messages(entry, what, diagnostics);
        LocaleSelector locales = locales(entry, diagnostics);
        OnGeneration onGeneration = null;
        RuleAttr og = entry.attrs.get("onGeneration");
        if (og != null) {
            onGeneration = OnGeneration.fromKeyword(og.text());
            if (onGeneration == null) {
                error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID,
                        "onGeneration is 'holdBack' or 'fail', not '" + og.text() + "'", og.line(), og.column());
            } else if (level != RuleLevel.ERROR || scopes == null || !scopes.contains(RuleScope.GENERATION)) {
                error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID_MODIFIER,
                        "onGeneration only applies to a rule with level error and scope generation", og.line(), og.column());
            }
        }
        for (String key : List.of("level", "scope", "assert", "message")) {
            if (!entry.attrs.containsKey(key)) {
                error(diagnostics, DiagnosticCodes.CDL_RULE_MISSING_KEY,
                        what + " needs '" + key + "'" + missingHint(key), entry.line, entry.column);
            }
        }
        if (target == null || level == null || scopes == null || scopes.isEmpty() || assertion == null
                || messages.isEmpty()) {
            return null;
        }
        return new RuleDefinition(entry.name, target, level, scopes, when, assertion, messages, locales, onGeneration,
                entry.line, entry.column);
    }

    private static String missingHint(String key) {
        return switch (key) {
            case "level" -> " (hint, info, warning or error)";
            case "scope" -> " (a list of edit, save, release, generation)";
            case "assert" -> " (the condition that must hold)";
            default -> " (e.g. message { en \"…\" })";
        };
    }

    private static StateDefinition state(RuleEntryNode entry, List<Diagnostic> diagnostics) {
        RulePath target = target(entry, false, diagnostics);
        String what = "The state of '" + entry.target + "'";
        CompiledExpression requiredWhen = expression(entry, "requiredWhen", what, false, diagnostics);
        CompiledExpression readOnlyWhen = expression(entry, "readOnlyWhen", what, false, diagnostics);
        if (!entry.attrs.containsKey("requiredWhen") && !entry.attrs.containsKey("readOnlyWhen")) {
            error(diagnostics, DiagnosticCodes.CDL_RULE_MISSING_KEY,
                    what + " needs 'requiredWhen' or 'readOnlyWhen'", entry.line, entry.column);
            return null;
        }
        RuleLevel level = entry.attrs.containsKey("level") ? level(entry, what, diagnostics) : null;
        Set<RuleScope> scopes = entry.attrs.containsKey("scope")
                ? scopes(entry, "scope", what, EnumSet.allOf(RuleScope.class), diagnostics)
                : null;
        RuleMessages messages = entry.attrs.containsKey("message") ? messages(entry, what, diagnostics) : RuleMessages.NONE;
        if (target == null || (entry.attrs.containsKey("requiredWhen") && requiredWhen == null)
                || (entry.attrs.containsKey("readOnlyWhen") && readOnlyWhen == null)) {
            return null;
        }
        return new StateDefinition(target, requiredWhen, readOnlyWhen, level, scopes, messages, entry.line, entry.column);
    }

    private static FillDefinition fill(RuleEntryNode entry, List<Diagnostic> diagnostics) {
        RulePath target = target(entry, false, diagnostics);
        String what = "The fill of '" + entry.target + "'";
        CompiledExpression value = expression(entry, "value", what, false, diagnostics);
        if (!entry.attrs.containsKey("value")) {
            error(diagnostics, DiagnosticCodes.CDL_RULE_MISSING_KEY,
                    what + " needs 'value' (the expression it computes)", entry.line, entry.column);
        }
        FillMode mode = FillMode.EMPTY;
        RuleAttr modeAttr = entry.attrs.get("mode");
        if (modeAttr != null) {
            mode = FillMode.fromKeyword(modeAttr.text());
            if (mode == null) {
                error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID,
                        "mode is 'empty' or 'always', not '" + modeAttr.text() + "'", modeAttr.line(), modeAttr.column());
                mode = FillMode.EMPTY;
            }
        }
        Set<RuleScope> on = scopes(entry, "on", what, FILL_SCOPES, diagnostics);
        if (!entry.attrs.containsKey("on")) {
            error(diagnostics, DiagnosticCodes.CDL_RULE_MISSING_KEY,
                    what + " needs 'on' (a list of edit, save, release)", entry.line, entry.column);
        }
        if (target == null || value == null || on == null || on.isEmpty()) {
            return null;
        }
        return new FillDefinition(target, value, mode, on, entry.line, entry.column);
    }

    // ------------------------------------------------------------------

    private static RulePath target(RuleEntryNode entry, boolean wholeAllowed, List<Diagnostic> diagnostics) {
        if (entry.target == null) {
            if (wholeAllowed) {
                // A rule without 'on' applies to the whole definition.
                return RulePath.whole("");
            }
            return null; // the parser already reported the missing target
        }
        RulePath path = RulePath.parse(entry.target);
        if (path == null) {
            error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID,
                    "Invalid target '" + entry.target + "'", entry.targetLine, entry.targetColumn);
            return null;
        }
        if (path.isWhole() && !wholeAllowed) {
            error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID,
                    "A " + entry.kind + " applies to an editor, not to the whole '" + path.whole() + "'",
                    entry.targetLine, entry.targetColumn);
            return null;
        }
        return path;
    }

    private static RuleLevel level(RuleEntryNode entry, String what, List<Diagnostic> diagnostics) {
        RuleAttr attr = entry.attrs.get("level");
        if (attr == null) {
            return null;
        }
        RuleLevel level = RuleLevel.fromKeyword(attr.text());
        if (level == null) {
            error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID,
                    what + ": level is hint, info, warning or error, not '" + attr.text() + "'", attr.line(), attr.column());
        }
        return level;
    }

    private static Set<RuleScope> scopes(
            RuleEntryNode entry, String key, String what, Set<RuleScope> allowed, List<Diagnostic> diagnostics) {
        RuleAttr attr = entry.attrs.get(key);
        if (attr == null) {
            return null;
        }
        Set<RuleScope> scopes = EnumSet.noneOf(RuleScope.class);
        for (String word : attr.list()) {
            RuleScope scope = RuleScope.fromKeyword(word);
            if (scope == null || !allowed.contains(scope)) {
                error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID,
                        what + ": '" + word + "' is not a " + key + " here; use "
                                + String.join(", ", allowed.stream().map(RuleScope::keyword).sorted().toList()),
                        attr.line(), attr.column());
            } else {
                scopes.add(scope);
            }
        }
        if (attr.list().isEmpty()) {
            error(diagnostics, DiagnosticCodes.CDL_RULE_MISSING_KEY, what + ": '" + key + "' is empty",
                    attr.line(), attr.column());
        }
        return scopes;
    }

    /** Compiles a v2 expression key; a literal that isn't a boolean is an error for a condition. */
    private static CompiledExpression expression(
            RuleEntryNode entry, String key, String what, boolean required, List<Diagnostic> diagnostics) {
        RuleAttr attr = entry.attrs.get(key);
        if (attr == null) {
            return null;
        }
        boolean condition = !"value".equals(key);
        try {
            CompiledExpression compiled = ExpressionCompiler.compile(attr.text());
            if (condition) {
                JsonNode constant = compiled.constant().orElse(null);
                if (constant != null && !constant.isBoolean()) {
                    error(diagnostics, DiagnosticCodes.CDL_RULE_EXPRESSION,
                            what + ": '" + key + "' must be a condition (true or false), not the constant "
                                    + constant, attr.line(), attr.column());
                    return null;
                }
            }
            return compiled;
        } catch (ExpressionError e) {
            error(diagnostics, DiagnosticCodes.CDL_RULE_EXPRESSION,
                    what + ": invalid '" + key + "' expression: " + e.getMessage(),
                    attr.line(), attr.column() + 1 + Math.max(e.position(), 0));
            return null;
        }
    }

    private static RuleMessages messages(RuleEntryNode entry, String what, List<Diagnostic> diagnostics) {
        RuleAttr attr = entry.attrs.get("message");
        if (attr == null || attr.map() == null) {
            return RuleMessages.NONE;
        }
        RuleMessages messages = new RuleMessages(attr.map());
        if (messages.isEmpty()) {
            error(diagnostics, DiagnosticCodes.CDL_RULE_MISSING_KEY, what + ": the message map is empty",
                    attr.line(), attr.column());
        }
        checkPlaceholders(messages, what, attr.line(), attr.column(), DiagnosticCodes.CDL_RULE_INVALID, diagnostics);
        return messages;
    }

    private static void checkPlaceholders(
            RuleMessages messages, String what, int line, int column, String code, List<Diagnostic> diagnostics) {
        Set<String> unknown = messages.unknownPlaceholders();
        if (!unknown.isEmpty()) {
            error(diagnostics, code,
                    what + ": unknown placeholder " + String.join(", ", unknown.stream().map(p -> "{" + p + "}").toList())
                            + "; use " + String.join(", ", RuleMessages.PLACEHOLDERS.stream().sorted().map(p -> "{" + p + "}").toList()),
                    line, column);
        }
    }

    private static LocaleSelector locales(RuleEntryNode entry, List<Diagnostic> diagnostics) {
        RuleAttr attr = entry.attrs.get("locales");
        if (attr == null) {
            return LocaleSelector.ALL;
        }
        if (attr.text() != null) {
            if ("all".equals(attr.text())) {
                return LocaleSelector.ALL;
            }
            error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID,
                    "locales is 'all' or a list such as [default] or [de, en], not '" + attr.text() + "'",
                    attr.line(), attr.column());
            return LocaleSelector.ALL;
        }
        List<String> codes = attr.list();
        if (codes.contains("default")) {
            if (codes.size() > 1) {
                error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID,
                        "locales [default] stands alone; list the codes instead", attr.line(), attr.column());
            }
            return LocaleSelector.DEFAULT;
        }
        if (codes.isEmpty()) {
            error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID, "locales is empty", attr.line(), attr.column());
            return LocaleSelector.ALL;
        }
        return LocaleSelector.of(codes);
    }

    // ------------------------------------------------------------------
    // Built-in modifiers
    // ------------------------------------------------------------------

    /** The built-in overrides of one editor: its modifiers, and a {@code pattern}'s {@code message "…"}. */
    static Map<String, BuiltinRule> builtins(EditorNode node, List<Diagnostic> diagnostics) {
        Map<String, BuiltinRule> out = new LinkedHashMap<>();
        for (Map.Entry<String, ModifierNode> e : node.builtinModifiers.entrySet()) {
            String name = e.getKey();
            ModifierNode m = e.getValue();
            String what = "'" + name + "' on editor '" + node.name + "'";
            RuleLevel level = null;
            if (m.level != null) {
                level = RuleLevel.fromKeyword(m.level);
                if (level == null) {
                    error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID_MODIFIER,
                            what + ": level is hint, info, warning or error, not '" + m.level + "'", m.line, m.column);
                }
            }
            Set<RuleScope> scopes = null;
            if (m.scopes != null) {
                scopes = EnumSet.noneOf(RuleScope.class);
                for (String word : m.scopes) {
                    RuleScope scope = RuleScope.fromKeyword(word);
                    if (scope == null) {
                        error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID_MODIFIER,
                                what + ": '" + word + "' is not a scope; use edit, save, release, generation", m.line, m.column);
                    } else {
                        scopes.add(scope);
                    }
                }
                if (m.scopes.isEmpty()) {
                    error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID_MODIFIER, what + ": scope is empty", m.line, m.column);
                }
            }
            OnGeneration onGeneration = null;
            if (m.onGeneration != null) {
                onGeneration = OnGeneration.fromKeyword(m.onGeneration);
                RuleLevel effectiveLevel = level != null ? level : BUILTIN_LEVEL;
                Set<RuleScope> effectiveScopes = scopes != null ? scopes : BUILTIN_SCOPES;
                if (onGeneration == null) {
                    error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID_MODIFIER,
                            what + ": onGeneration is 'holdBack' or 'fail', not '" + m.onGeneration + "'", m.line, m.column);
                } else if (effectiveLevel != RuleLevel.ERROR || !effectiveScopes.contains(RuleScope.GENERATION)) {
                    error(diagnostics, DiagnosticCodes.CDL_RULE_INVALID_MODIFIER,
                            what + ": onGeneration only applies with level error and scope generation", m.line, m.column);
                    onGeneration = null;
                }
            }
            RuleMessages messages = m.messages == null ? RuleMessages.NONE : new RuleMessages(m.messages);
            checkPlaceholders(messages, what, m.line, m.column, DiagnosticCodes.CDL_RULE_INVALID_MODIFIER, diagnostics);
            out.put(name, new BuiltinRule(name, level, scopes, onGeneration, messages));
        }
        if (node.patternMessage != null && !node.patternMessage.isBlank()) {
            BuiltinRule pattern = out.get("pattern");
            if (pattern == null) {
                out.put("pattern", new BuiltinRule("pattern", null, null, null, RuleMessages.english(node.patternMessage)));
            } else if (pattern.messages().isEmpty()) {
                out.put("pattern", new BuiltinRule("pattern", pattern.level(), pattern.scopes(), pattern.onGeneration(),
                        RuleMessages.english(node.patternMessage)));
            }
        }
        return out;
    }

    private static void error(List<Diagnostic> diagnostics, String code, String message, int line, int column) {
        diagnostics.add(Diagnostic.error(code, message, line, column));
    }
}
