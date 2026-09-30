package com.acme.staticforge.template.expression;

import com.acme.staticforge.template.expression.ExpressionNode.Binary;
import com.acme.staticforge.template.expression.ExpressionNode.BinaryOp;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.math.BigDecimal;
import java.math.MathContext;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Evaluates a syntax tree against a scope (M33.1). One instance per evaluation; not thread-safe. */
final class ExpressionInterpreter {

    /** The name {@code any}/{@code all} bind each list element to. */
    static final String IT = "it";

    private final ExpressionScope scope;
    private final ExpressionHost host;
    private final EvaluationBudget budget;
    private final Map<String, JsonNode> locals = new HashMap<>();

    ExpressionInterpreter(ExpressionScope scope, ExpressionHost host, EvaluationBudget budget) {
        this.scope = scope;
        this.host = host == null ? ExpressionHost.NONE : host;
        this.budget = budget;
    }

    JsonNode eval(ExpressionNode node) {
        if (budget != null) {
            budget.tick(1);
        }
        try {
            JsonNode result = switch (node) {
                case ExpressionNode.Literal l -> l.value();
                case ExpressionNode.Ident i -> ident(i);
                case ExpressionNode.GlobalRef g -> walk(scope == null ? null : scope.global(g.set()), g.path(), 0);
                case ExpressionNode.Member m -> member(eval(m.target()), m.name());
                case ExpressionNode.Index ix -> index(eval(ix.target()), eval(ix.index()));
                case ExpressionNode.ListLiteral list -> list(list);
                case ExpressionNode.Call call -> call(call);
                case ExpressionNode.Unary u -> unary(u);
                case ExpressionNode.Binary b -> binary(b);
                case ExpressionNode.Ternary t -> ExpressionValues.truthy(eval(t.condition())) ? eval(t.then()) : eval(t.otherwise());
            };
            return result == null || result.isMissingNode() ? NullNode.getInstance() : result;
        } catch (ExpressionError e) {
            throw e;
        } catch (ArithmeticException e) {
            throw new ExpressionError("Arithmetic error: " + e.getMessage(), node.pos());
        } catch (RuntimeException e) {
            throw new ExpressionError("Evaluation failed: " + e.getMessage(), node.pos());
        }
    }

    private JsonNode ident(ExpressionNode.Ident ident) {
        String root = ident.path().get(0);
        JsonNode start = locals.containsKey(root) ? locals.get(root) : (scope == null ? null : scope.root(root));
        return walk(start, ident.path(), 1);
    }

    private static JsonNode walk(JsonNode start, List<String> path, int from) {
        JsonNode node = start;
        for (int i = from; i < path.size(); i++) {
            if (node == null) {
                return NullNode.getInstance();
            }
            node = node.get(path.get(i));
        }
        return node == null ? NullNode.getInstance() : node;
    }

    private static JsonNode member(JsonNode target, String name) {
        if (target == null || !target.isObject()) {
            return NullNode.getInstance();
        }
        JsonNode v = target.get(name);
        return v == null ? NullNode.getInstance() : v;
    }

    private static JsonNode index(JsonNode target, JsonNode index) {
        if (target == null) {
            return NullNode.getInstance();
        }
        if (target.isArray() && index.isNumber()) {
            int i = index.intValue();
            if (i < 0) {
                i += target.size();
            }
            return i >= 0 && i < target.size() ? target.get(i) : NullNode.getInstance();
        }
        if (target.isObject() && index.isTextual()) {
            return member(target, index.asText());
        }
        return NullNode.getInstance();
    }

    private JsonNode list(ExpressionNode.ListLiteral list) {
        ArrayNode out = JsonNodeFactory.instance.arrayNode(list.items().size());
        for (ExpressionNode item : list.items()) {
            out.add(eval(item));
        }
        return out;
    }

    private JsonNode call(ExpressionNode.Call call) {
        ExpressionFunctions.Definition def = ExpressionFunctions.lookup(call.name());
        if (def == null) {
            throw new ExpressionError("Unknown function '" + call.name() + "'", call.pos());
        }
        if (def.lazy()) {
            return quantifier(call, "all".equals(call.name()));
        }
        List<JsonNode> args = new ArrayList<>(call.args().size());
        for (ExpressionNode arg : call.args()) {
            args.add(eval(arg));
        }
        return def.impl().apply(args, new ExpressionFunctions.Call(host, call.pos()));
    }

    /** {@code any(list, test)} / {@code all(list, test)}: {@code test} runs per element with the element as {@code it}. */
    private JsonNode quantifier(ExpressionNode.Call call, boolean all) {
        List<JsonNode> elements = ExpressionFunctions.list(eval(call.args().get(0)), call.name(), call.pos());
        boolean hadIt = locals.containsKey(IT);
        JsonNode previous = locals.get(IT);
        try {
            for (JsonNode element : elements) {
                locals.put(IT, element);
                boolean passed = ExpressionValues.truthy(eval(call.args().get(1)));
                if (all && !passed) {
                    return BooleanNode.FALSE;
                }
                if (!all && passed) {
                    return BooleanNode.TRUE;
                }
            }
            return BooleanNode.valueOf(all);
        } finally {
            if (hadIt) {
                locals.put(IT, previous);
            } else {
                locals.remove(IT);
            }
        }
    }

    private JsonNode unary(ExpressionNode.Unary u) {
        JsonNode v = eval(u.operand());
        return switch (u.op()) {
            case NOT -> BooleanNode.valueOf(!ExpressionValues.truthy(v));
            case TRUTHY -> BooleanNode.valueOf(ExpressionValues.truthy(v));
            case NEGATE -> ExpressionValues.isNull(v)
                    ? NullNode.getInstance()
                    : ExpressionValues.number(ExpressionValues.decimal(v, "'-'", u.pos()).negate());
        };
    }

    private JsonNode binary(Binary b) {
        switch (b.op()) {
            case OR -> {
                return BooleanNode.valueOf(ExpressionValues.truthy(eval(b.left())) || ExpressionValues.truthy(eval(b.right())));
            }
            case AND -> {
                return BooleanNode.valueOf(ExpressionValues.truthy(eval(b.left())) && ExpressionValues.truthy(eval(b.right())));
            }
            case COALESCE -> {
                JsonNode left = eval(b.left());
                return ExpressionValues.isNull(left) ? eval(b.right()) : left;
            }
            default -> {
                // operands evaluated below
            }
        }
        JsonNode left = eval(b.left());
        JsonNode right = eval(b.right());
        if (b.v1()) {
            return BooleanNode.valueOf(v1Compare(b.op(), left, right));
        }
        return switch (b.op()) {
            case EQ -> BooleanNode.valueOf(ExpressionValues.equal(left, right));
            case NEQ -> BooleanNode.valueOf(!ExpressionValues.equal(left, right));
            case LT, LTE, GT, GTE -> {
                if (ExpressionValues.isNull(left) || ExpressionValues.isNull(right)) {
                    yield BooleanNode.FALSE;
                }
                int cmp = ExpressionValues.compare(left, right, b.pos());
                yield BooleanNode.valueOf(switch (b.op()) {
                    case LT -> cmp < 0;
                    case LTE -> cmp <= 0;
                    case GT -> cmp > 0;
                    default -> cmp >= 0;
                });
            }
            case IN -> BooleanNode.valueOf(in(left, right));
            case ADD -> add(left, right, b.pos());
            case SUB, MUL, DIV, MOD -> arithmetic(b.op(), left, right, b.pos());
            default -> throw new ExpressionError("Unsupported operator " + b.op(), b.pos());
        };
    }

    private static boolean in(JsonNode value, JsonNode container) {
        if (ExpressionValues.isNull(container)) {
            return false;
        }
        if (container.isArray()) {
            for (JsonNode e : container) {
                if (ExpressionValues.equal(e, value)) {
                    return true;
                }
            }
            return false;
        }
        if (container.isObject()) {
            return !ExpressionValues.isNull(value) && container.has(ExpressionValues.text(value));
        }
        if (container.isTextual()) {
            return !ExpressionValues.isNull(value) && container.asText().contains(ExpressionValues.text(value));
        }
        return false;
    }

    private static JsonNode add(JsonNode left, JsonNode right, int pos) {
        if (left.isTextual() || right.isTextual()) {
            return TextNode.valueOf(ExpressionValues.text(left) + ExpressionValues.text(right));
        }
        return arithmetic(BinaryOp.ADD, left, right, pos);
    }

    private static JsonNode arithmetic(BinaryOp op, JsonNode left, JsonNode right, int pos) {
        if (ExpressionValues.isNull(left) || ExpressionValues.isNull(right)) {
            return NullNode.getInstance();
        }
        String symbol = switch (op) {
            case ADD -> "'+'";
            case SUB -> "'-'";
            case MUL -> "'*'";
            case DIV -> "'/'";
            default -> "'%'";
        };
        BigDecimal a = ExpressionValues.decimal(left, symbol, pos);
        BigDecimal b = ExpressionValues.decimal(right, symbol, pos);
        if ((op == BinaryOp.DIV || op == BinaryOp.MOD) && b.signum() == 0) {
            throw new ExpressionError("Division by zero", pos);
        }
        return ExpressionValues.number(switch (op) {
            case ADD -> a.add(b);
            case SUB -> a.subtract(b);
            case MUL -> a.multiply(b);
            case DIV -> a.divide(b, MathContext.DECIMAL64);
            default -> a.remainder(b);
        });
    }

    // ------------------------------------------------------------------
    // v1 comparisons, unchanged: text order for non-numbers, substring for `in` against text
    // ------------------------------------------------------------------

    private static boolean v1Compare(BinaryOp op, JsonNode left, JsonNode right) {
        return switch (op) {
            case EQ -> v1Equal(left, right);
            case NEQ -> !v1Equal(left, right);
            case GT -> v1Cmp(left, right) > 0;
            case LT -> v1Cmp(left, right) < 0;
            case GTE -> v1Cmp(left, right) >= 0;
            case LTE -> v1Cmp(left, right) <= 0;
            case IN -> v1In(right, left);
            default -> false;
        };
    }

    private static boolean v1Equal(JsonNode a, JsonNode b) {
        if (a.isNull() || b.isNull()) {
            return a.isNull() && b.isNull();
        }
        if (a.isNumber() && b.isNumber()) {
            return a.asDouble() == b.asDouble();
        }
        return a.equals(b);
    }

    private static int v1Cmp(JsonNode a, JsonNode b) {
        if (a.isNumber() && b.isNumber()) {
            return Double.compare(a.asDouble(), b.asDouble());
        }
        return a.asText().compareTo(b.asText());
    }

    private static boolean v1In(JsonNode array, JsonNode value) {
        if (array.isArray()) {
            for (JsonNode e : array) {
                if (v1Equal(e, value)) {
                    return true;
                }
            }
            return false;
        }
        if (array.isTextual()) {
            return array.asText().contains(value.asText());
        }
        return false;
    }
}
