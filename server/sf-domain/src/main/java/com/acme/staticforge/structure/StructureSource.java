package com.acme.staticforge.structure;

import java.util.List;

/**
 * The parsed, declarative source of a structure asset (spec §17.1): which pages form the
 * collection, how they are filtered, ordered, expanded and cut.
 *
 * <p>{@code include}/{@code exclude} are expression strings evaluated against a page scope
 * {@code { displayName, nav: {visible, position, label, noIndex}, meta: {...} }} via the
 * template {@code ExpressionEvaluator}. {@code depth} caps the tree; {@code orderBy} lists
 * the deterministic sort; {@code expand} selects the nesting semantics.
 */
public record StructureSource(
        StructureKind kind,
        StructureRoot root,
        int depth,
        List<String> include,
        List<String> exclude,
        List<OrderClause> orderBy,
        ExpandMode expand) {

    public static final int DEFAULT_DEPTH = 3;
    public static final List<OrderClause> DEFAULT_ORDER =
            List.of(new OrderClause("nav.position", true), new OrderClause("displayName", true));

    public StructureSource {
        include = include == null ? List.of() : List.copyOf(include);
        exclude = exclude == null ? List.of() : List.copyOf(exclude);
        orderBy = orderBy == null || orderBy.isEmpty() ? DEFAULT_ORDER : List.copyOf(orderBy);
        expand = expand == null ? ExpandMode.ACTIVE_PATH_ONLY : expand;
    }
}
