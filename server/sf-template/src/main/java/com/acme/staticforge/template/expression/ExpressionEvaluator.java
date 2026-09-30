package com.acme.staticforge.template.expression;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The {@code visibleWhen} entry point (spec §14.4): evaluates an expression in the {@link ExpressionMode#V1} grammar —
 * {@code identifier (== | != | > | < | >= | <= | in) literal} combined with {@code &&}, {@code ||}, {@code !} and
 * parentheses — exactly as before M33, which the Angular form engine mirrors (same test-fixture file). Compiled
 * expressions are cached. Rule expressions (v2) are compiled with {@link ExpressionCompiler}.
 */
public final class ExpressionEvaluator {

    private static final int CACHE_SIZE = 512;

    private final Map<String, CompiledExpression> cache = new LinkedHashMap<>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, CompiledExpression> eldest) {
            return size() > CACHE_SIZE;
        }
    };

    /**
     * Evaluates a v1 expression against {@code scope} (each field a root identifier); blank means {@code true}.
     *
     * @throws ExpressionError (an {@link IllegalArgumentException}) for a syntax error
     */
    public boolean evaluate(String expression, JsonNode scope) {
        if (expression == null || expression.isBlank()) {
            return true;
        }
        return compiled(expression).test(ExpressionScope.of(scope), ExpressionHost.NONE, null);
    }

    /** Returns the identifiers (dotted paths) referenced by a v1 expression, in order of appearance. */
    public List<String> identifiers(String expression) {
        if (expression == null || expression.isBlank()) {
            return List.of();
        }
        return compiled(expression).identifiers();
    }

    private CompiledExpression compiled(String expression) {
        synchronized (cache) {
            CompiledExpression hit = cache.get(expression);
            if (hit != null) {
                return hit;
            }
        }
        CompiledExpression compiled = ExpressionCompiler.compile(expression, ExpressionMode.V1);
        synchronized (cache) {
            cache.put(expression, compiled);
        }
        return compiled;
    }
}
