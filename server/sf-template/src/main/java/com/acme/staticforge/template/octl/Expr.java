package com.acme.staticforge.template.octl;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * An OCTL boolean/expression tree (spec §16.9): {@code or/and/cmp/unary} over literals,
 * accessors (with optional filters) and parenthesized groups.
 *
 * <p>Evaluation is performed by the renderer against the current scope; these nodes are
 * immutable data only. Comparison operators are {@code == != < > <= >= in} plus the unary
 * {@code !}.
 */
public sealed interface Expr {

    /** A literal value: string, number, boolean, or {@code null}. */
    record Literal(JsonNode value) implements Expr {}

    /** An accessor with an optional filter chain, evaluated to its rendered value. */
    record Access(Accessor accessor, List<FilterNode> filters) implements Expr {
        public Access {
            filters = filters == null ? List.of() : List.copyOf(filters);
        }
    }

    /** A parenthesized sub-expression. */
    record Group(Expr inner) implements Expr {}

    /** Logical negation applied to truthiness. */
    record Not(Expr operand) implements Expr {}

    /** Logical conjunction. */
    record And(Expr left, Expr right) implements Expr {}

    /** Logical disjunction. */
    record Or(Expr left, Expr right) implements Expr {}

    /** A comparison: {@code == != < > <= >= in}. */
    record Cmp(String operator, Expr left, Expr right) implements Expr {}
}
