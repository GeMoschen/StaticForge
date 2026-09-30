package com.acme.staticforge.template.expression;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/** The syntax tree of a compiled expression (M33.1); both grammars build the same nodes. {@code pos} is the source offset. */
sealed interface ExpressionNode {

    int pos();

    /** A constant: string, number, boolean or null. */
    record Literal(JsonNode value, int pos) implements ExpressionNode {}

    /** A dotted path from a root identifier: {@code title}, {@code item.caption}. */
    record Ident(List<String> path, int pos) implements ExpressionNode {
        public Ident {
            path = List.copyOf(path);
        }
    }

    /** {@code global:<set>.<path>}. */
    record GlobalRef(String set, List<String> path, int pos) implements ExpressionNode {
        public GlobalRef {
            path = List.copyOf(path);
        }
    }

    /** {@code target.name} on a value that isn't a plain identifier path, e.g. {@code ref(value).meta}. */
    record Member(ExpressionNode target, String name, int pos) implements ExpressionNode {}

    /** {@code target[index]}: a list position or an object key. */
    record Index(ExpressionNode target, ExpressionNode index, int pos) implements ExpressionNode {}

    /** {@code [a, b, c]}. */
    record ListLiteral(List<ExpressionNode> items, int pos) implements ExpressionNode {
        public ListLiteral {
            items = List.copyOf(items);
        }
    }

    /** {@code name(args…)}. */
    record Call(String name, List<ExpressionNode> args, int pos) implements ExpressionNode {
        public Call {
            args = List.copyOf(args);
        }
    }

    /** Unary operators: {@code !}, {@code -}, and the v1 truthiness test of a bare atom. */
    record Unary(UnaryOp op, ExpressionNode operand, int pos) implements ExpressionNode {}

    /** Binary operators; {@code v1} marks the v1 comparison semantics (text comparison of non-numbers). */
    record Binary(BinaryOp op, ExpressionNode left, ExpressionNode right, boolean v1, int pos) implements ExpressionNode {}

    /** {@code condition ? then : otherwise}. */
    record Ternary(ExpressionNode condition, ExpressionNode then, ExpressionNode otherwise, int pos)
            implements ExpressionNode {}

    enum UnaryOp { NOT, NEGATE, TRUTHY }

    enum BinaryOp { OR, AND, EQ, NEQ, LT, LTE, GT, GTE, IN, ADD, SUB, MUL, DIV, MOD, COALESCE }
}
