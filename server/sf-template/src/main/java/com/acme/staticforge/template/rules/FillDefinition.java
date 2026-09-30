package com.acme.staticforge.template.rules;

import com.acme.staticforge.template.expression.CompiledExpression;
import java.util.Set;

/**
 * A computed value (M33, epic decision 1): {@code value} is written to {@code target} in the scopes of {@code on}
 * (a subset of {@code edit}, {@code save}, {@code release}), only into an empty field ({@link FillMode#EMPTY}) or
 * always ({@link FillMode#ALWAYS}, which makes the field read-only in the editor).
 */
public record FillDefinition(
        RulePath target,
        CompiledExpression value,
        FillMode mode,
        Set<RuleScope> on,
        int line,
        int column) {

    public FillDefinition {
        on = on == null ? Set.of() : Set.copyOf(on);
        mode = mode == null ? FillMode.EMPTY : mode;
    }

    public boolean runsIn(RuleScope scope) {
        return on.contains(scope);
    }
}
