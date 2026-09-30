package com.acme.staticforge.template.expression;

import com.fasterxml.jackson.annotation.JsonValue;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * An expression parsed and checked once, evaluated many times (M33.1). Immutable and thread-safe; every evaluation gets
 * its own interpreter. Evaluation never throws anything but {@link ExpressionError}.
 */
public final class CompiledExpression {

    private final String source;
    private final ExpressionMode mode;
    private final ExpressionNode root;
    private final List<String> identifiers;
    private final Set<String> functions;

    CompiledExpression(String source, ExpressionMode mode, ExpressionNode root) {
        this.source = source;
        this.mode = mode;
        this.root = root;
        Set<String> ids = new LinkedHashSet<>();
        Set<String> fns = new LinkedHashSet<>();
        collect(root, ids, fns, Set.of());
        this.identifiers = List.copyOf(ids);
        this.functions = Set.copyOf(fns);
    }

    /** The source text; also the JSON form of a compiled expression (a stored compiled definition holds the text). */
    @JsonValue
    public String source() {
        return source;
    }

    public ExpressionMode mode() {
        return mode;
    }

    /** Evaluates with no host (no {@code ref}, UTC clock) and the default budget. */
    public JsonNode evaluate(ExpressionScope scope) {
        return evaluate(scope, ExpressionHost.NONE, EvaluationBudget.standard());
    }

    /** The value of the expression; JSON null for a missing value. */
    public JsonNode evaluate(ExpressionScope scope, ExpressionHost host, EvaluationBudget budget) {
        return new ExpressionInterpreter(scope, host, budget).eval(root);
    }

    /**
     * The expression as a condition. A v1 expression is always boolean; a v2 expression must yield {@code true} or
     * {@code false} — any other value is an {@link ExpressionError} (a rule's {@code assert} or {@code when} that
     * doesn't produce a boolean).
     */
    public boolean test(ExpressionScope scope, ExpressionHost host, EvaluationBudget budget) {
        JsonNode result = evaluate(scope, host, budget);
        if (mode == ExpressionMode.V1) {
            return ExpressionValues.truthy(result);
        }
        if (!result.isBoolean()) {
            throw new ExpressionError("Expected true or false, got " + ExpressionValues.describe(result));
        }
        return result.asBoolean();
    }

    /**
     * The root paths the expression reads, in order of appearance: {@code title}, {@code item.caption}, {@code value},
     * {@code global:site.title}. Paths inside {@code ref(…)} results and the {@code it} of {@code any}/{@code all}
     * are not included; a call's argument paths are.
     */
    public List<String> identifiers() {
        return identifiers;
    }

    /** The functions the expression calls. */
    public Set<String> functions() {
        return functions;
    }

    /** The value when the whole expression is a single literal ({@code "true"}, {@code 'x'}, {@code 3}). */
    public Optional<JsonNode> constant() {
        return root instanceof ExpressionNode.Literal l ? Optional.of(l.value()) : Optional.empty();
    }

    @Override
    public String toString() {
        return source;
    }

    private static void collect(ExpressionNode node, Set<String> ids, Set<String> fns, Set<String> locals) {
        switch (node) {
            case ExpressionNode.Literal l -> { }
            case ExpressionNode.Ident i -> {
                if (!locals.contains(i.path().get(0))) {
                    ids.add(String.join(".", i.path()));
                }
            }
            case ExpressionNode.GlobalRef g -> ids.add("global:" + g.set() + (g.path().isEmpty() ? "" : "." + String.join(".", g.path())));
            case ExpressionNode.Member m -> collect(m.target(), ids, fns, locals);
            case ExpressionNode.Index ix -> {
                collect(ix.target(), ids, fns, locals);
                collect(ix.index(), ids, fns, locals);
            }
            case ExpressionNode.ListLiteral list -> list.items().forEach(item -> collect(item, ids, fns, locals));
            case ExpressionNode.Call call -> {
                fns.add(call.name());
                boolean quantifier = "any".equals(call.name()) || "all".equals(call.name());
                for (int i = 0; i < call.args().size(); i++) {
                    Set<String> scope = locals;
                    if (quantifier && i == 1) {
                        Set<String> withIt = new LinkedHashSet<>(locals);
                        withIt.add(ExpressionInterpreter.IT);
                        scope = withIt;
                    }
                    collect(call.args().get(i), ids, fns, scope);
                }
            }
            case ExpressionNode.Unary u -> collect(u.operand(), ids, fns, locals);
            case ExpressionNode.Binary b -> {
                collect(b.left(), ids, fns, locals);
                collect(b.right(), ids, fns, locals);
            }
            case ExpressionNode.Ternary t -> {
                collect(t.condition(), ids, fns, locals);
                collect(t.then(), ids, fns, locals);
                collect(t.otherwise(), ids, fns, locals);
            }
        }
    }

    /** The calls in the tree, for compile checks. */
    static List<ExpressionNode.Call> calls(ExpressionNode node) {
        List<ExpressionNode.Call> out = new ArrayList<>();
        walk(node, out);
        return out;
    }

    ExpressionNode root() {
        return root;
    }

    private static void walk(ExpressionNode node, List<ExpressionNode.Call> out) {
        switch (node) {
            case ExpressionNode.Call call -> {
                out.add(call);
                call.args().forEach(arg -> walk(arg, out));
            }
            case ExpressionNode.Member m -> walk(m.target(), out);
            case ExpressionNode.Index ix -> {
                walk(ix.target(), out);
                walk(ix.index(), out);
            }
            case ExpressionNode.ListLiteral list -> list.items().forEach(item -> walk(item, out));
            case ExpressionNode.Unary u -> walk(u.operand(), out);
            case ExpressionNode.Binary b -> {
                walk(b.left(), out);
                walk(b.right(), out);
            }
            case ExpressionNode.Ternary t -> {
                walk(t.condition(), out);
                walk(t.then(), out);
                walk(t.otherwise(), out);
            }
            default -> { }
        }
    }
}
