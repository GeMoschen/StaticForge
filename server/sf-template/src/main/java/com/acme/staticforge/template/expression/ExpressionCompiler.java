package com.acme.staticforge.template.expression;

/**
 * Compiles expression source into a {@link CompiledExpression} (M33.1): parses it in the given grammar and checks every
 * call against the function registry (name and number of arguments). Throws {@link ExpressionError} with the position
 * of the first problem.
 */
public final class ExpressionCompiler {

    private ExpressionCompiler() {}

    public static CompiledExpression compile(String source, ExpressionMode mode) {
        if (source == null || source.isBlank()) {
            throw new ExpressionError("Empty expression", 0);
        }
        ExpressionNode root = ExpressionParser.parse(source, mode);
        for (ExpressionNode.Call call : CompiledExpression.calls(root)) {
            ExpressionFunctions.Definition def = ExpressionFunctions.lookup(call.name());
            if (def == null) {
                throw new ExpressionError("Unknown function '" + call.name() + "'", call.pos());
            }
            int n = call.args().size();
            if (n < def.min() || (def.max() >= 0 && n > def.max())) {
                String expected = def.max() < 0
                        ? "at least " + def.min()
                        : def.min() == def.max() ? String.valueOf(def.min()) : def.min() + " to " + def.max();
                throw new ExpressionError(
                        call.name() + " takes " + expected + " argument" + ("1".equals(expected) ? "" : "s") + ", got " + n,
                        call.pos());
            }
        }
        return new CompiledExpression(source, mode, root);
    }

    /** A v2 (rule) expression. */
    public static CompiledExpression compile(String source) {
        return compile(source, ExpressionMode.V2);
    }
}
