package com.acme.staticforge.template.rules;

import com.acme.staticforge.template.expression.CompiledExpression;
import java.util.Set;

/**
 * A validation rule of a {@code rules {}} section (M33, epic decision 1): {@code assertion} must hold for
 * {@code target} (per row for a {@code list[]} target), in the {@code scopes} it names, else a finding of
 * {@code level} with {@code messages}. {@code when} is an optional precondition. {@code line}/{@code column} point at
 * the entry in its CDL source (0 when unknown).
 */
public record RuleDefinition(
        String name,
        RulePath target,
        RuleLevel level,
        Set<RuleScope> scopes,
        CompiledExpression when,
        CompiledExpression assertion,
        RuleMessages messages,
        LocaleSelector locales,
        OnGeneration onGeneration,
        int line,
        int column) {

    public RuleDefinition {
        scopes = scopes == null ? Set.of() : Set.copyOf(scopes);
        messages = messages == null ? RuleMessages.NONE : messages;
        locales = locales == null ? LocaleSelector.ALL : locales;
        onGeneration = onGeneration == null ? OnGeneration.HOLD_BACK : onGeneration;
    }

    /** Whether the rule runs in {@code scope}. */
    public boolean runsIn(RuleScope scope) {
        return scopes.contains(scope);
    }
}
