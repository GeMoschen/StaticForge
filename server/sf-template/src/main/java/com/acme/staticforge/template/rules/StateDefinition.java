package com.acme.staticforge.template.rules;

import com.acme.staticforge.template.expression.CompiledExpression;
import java.util.Set;

/**
 * A conditional field state (M33, epic decision 1): {@code requiredWhen} makes the field required — a built-in
 * {@code required} finding with this state's {@code level}/{@code scopes}, or the editor's {@code required} defaults
 * when {@code null} — and {@code readOnlyWhen} makes it read-only in the editor and keeps its stored value on save.
 */
public record StateDefinition(
        RulePath target,
        CompiledExpression requiredWhen,
        CompiledExpression readOnlyWhen,
        RuleLevel level,
        Set<RuleScope> scopes,
        RuleMessages messages,
        int line,
        int column) {

    public StateDefinition {
        scopes = scopes == null ? null : Set.copyOf(scopes);
        messages = messages == null ? RuleMessages.NONE : messages;
    }
}
