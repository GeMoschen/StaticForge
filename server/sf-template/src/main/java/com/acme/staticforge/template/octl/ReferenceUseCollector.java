package com.acme.staticforge.template.octl;

import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Walks a parsed OCTL AST and records, per {@code assetType:uid} reference key, every
 * {@link ReferenceUse} the template makes of it. Mirrors the reference-resolving positions of
 * {@link OctlCompiler}'s validation walk; kept as a separate pass so the classification doesn't
 * couple to diagnostics.
 */
final class ReferenceUseCollector {

    private static final String NAV = "nav";

    private final Map<String, Set<ReferenceUse>> uses = new LinkedHashMap<>();

    private ReferenceUseCollector() {}

    static Map<String, Set<ReferenceUse>> collect(List<OctlNode> nodes) {
        ReferenceUseCollector collector = new ReferenceUseCollector();
        collector.nodes(nodes);
        return collector.uses;
    }

    private void nodes(List<OctlNode> nodes) {
        for (OctlNode node : nodes) {
            switch (node) {
                case OctlNode.Value v -> record(v.accessor(), ReferenceUse.VALUE);
                case OctlNode.Ref r -> record(r.accessor(), ReferenceUse.REF);
                case OctlNode.Include i -> record(i.accessor(), ReferenceUse.INCLUDE);
                case OctlNode.Navigation nav -> {
                    record(nav.accessor(), ReferenceUse.REF);
                    nodes(nav.body());
                }
                case OctlNode.If f -> {
                    for (OctlNode.Branch branch : f.branches()) {
                        expr(branch.condition());
                        nodes(branch.body());
                    }
                    nodes(f.elseBody());
                }
                case OctlNode.For f -> {
                    record(f.accessor(), NAV.equals(f.accessor().assetType()) ? ReferenceUse.REF : ReferenceUse.VALUE);
                    nodes(f.body());
                }
                case OctlNode.Set st -> expr(st.expr());
                case OctlNode.Text t -> { /* nothing */ }
                case OctlNode.Body b -> { /* nothing */ }
                case OctlNode.NavigationRecurse nr -> { /* nothing */ }
                case OctlNode.Meta m -> { /* not resolved by the compiler */ }
                case OctlNode.Comment c -> { /* nothing */ }
            }
        }
    }

    private void expr(Expr expr) {
        switch (expr) {
            case Expr.Access a -> record(a.accessor(), ReferenceUse.VALUE);
            case Expr.Group g -> expr(g.inner());
            case Expr.Not n -> expr(n.operand());
            case Expr.And a -> {
                expr(a.left());
                expr(a.right());
            }
            case Expr.Or o -> {
                expr(o.left());
                expr(o.right());
            }
            case Expr.Cmp c -> {
                expr(c.left());
                expr(c.right());
            }
            case Expr.Literal l -> { /* nothing */ }
        }
    }

    private void record(Accessor accessor, ReferenceUse use) {
        if (accessor != null && accessor.isAssetReference()) {
            uses.computeIfAbsent(accessor.referenceKey(), k -> EnumSet.noneOf(ReferenceUse.class)).add(use);
        }
    }
}
