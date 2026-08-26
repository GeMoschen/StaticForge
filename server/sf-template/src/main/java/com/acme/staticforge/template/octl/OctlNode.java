package com.acme.staticforge.template.octl;

import java.util.List;

/**
 * The parsed OCTL template AST (spec §16.9). An immutable sequence of nodes produced by
 * the parser and walked by the renderer. All instruction nodes carry their 1-based source
 * position for diagnostics; text nodes do not need one.
 *
 * <p>This type is public only so the renderer (in the {@code render} package) can walk it;
 * it is not part of the stable public API of {@code sf-template}.
 */
public sealed interface OctlNode {

    /** Passthrough text. {@code $$} is reduced to a {@code Text("$")} by the lexer. */
    record Text(String value) implements OctlNode {}

    /** {@code $CMS_VALUE(accessor | filter… [, namedArgs])$}. */
    record Value(Accessor accessor, List<FilterNode> filters, List<NamedArg> args, int line, int col)
            implements OctlNode {
        public Value {
            filters = filters == null ? List.of() : List.copyOf(filters);
            args = args == null ? List.of() : List.copyOf(args);
        }
    }

    /** {@code $CMS_REF(accessor [, namedArgs])$}. */
    record Ref(Accessor accessor, List<NamedArg> args, int line, int col) implements OctlNode {
        public Ref {
            args = args == null ? List.of() : List.copyOf(args);
        }
    }

    /** {@code $CMS_BODY(name)$}. */
    record Body(String name, int line, int col) implements OctlNode {}

    /** {@code $CMS_INCLUDE(section_template:uid [, args])$}. */
    record Include(Accessor accessor, List<NamedArg> args, int line, int col) implements OctlNode {
        public Include {
            args = args == null ? List.of() : List.copyOf(args);
        }
    }

    /**
     * {@code $CMS_NAVIGATION(nav:uid [, depth=N] [, channel=key])$} (spec §16.9, `M8.1.4`), or
     * its block form {@code $CMS_NAVIGATION(nav:uid [, args]) as item$ … $CMS_END_NAVIGATION$}.
     *
     * <p>{@code variable == null} (equivalently {@code body.isEmpty()}) is the original
     * self-closing (leaf) form, like {@link Include}: rendering the resolved navigation folder's
     * tree — including any nested-list markup — is delegated entirely to {@code
     * BlockResolver#renderNavigation}. When {@code variable} is present, the folder's top-level
     * children are fetched via {@code BlockResolver#resolveNavigationChildren} and {@code body}
     * is rendered once per child with {@code variable} bound to it in loop scope (mirroring
     * {@link For}) — letting a template author supply their own per-node markup, descending
     * further via {@link NavigationRecurse}.
     */
    record Navigation(Accessor accessor, List<NamedArg> args, String variable, List<OctlNode> body, int line, int col)
            implements OctlNode {
        public Navigation {
            args = args == null ? List.of() : List.copyOf(args);
            body = body == null ? List.of() : List.copyOf(body);
        }
    }

    /**
     * {@code $CMS_NAVIGATION_RECURSE(item)$} — valid only inside the body of a block-form {@link
     * Navigation} bound to the same {@code variable} name; renders that node's children using the
     * enclosing {@code Navigation}'s own body template, one level deeper (spec-analogous to the
     * old {@code $CMS_NAV_RECURSE$}).
     */
    record NavigationRecurse(String variable, int line, int col) implements OctlNode {}

    /** {@code $CMS_IF(expr)$ … $CMS_ELSEIF(expr)$ … $CMS_ELSE$ … $CMS_END_IF$}. */
    record If(List<Branch> branches, List<OctlNode> elseBody, int line, int col) implements OctlNode {
        public If {
            branches = branches == null ? List.of() : List.copyOf(branches);
            elseBody = elseBody == null ? List.of() : List.copyOf(elseBody);
        }
    }

    /** One {@code $CMS_IF}/{@code $CMS_ELSEIF} arm. */
    record Branch(Expr condition, List<OctlNode> body) {
        public Branch {
            body = body == null ? List.of() : List.copyOf(body);
        }
    }

    /**
     * {@code $CMS_FOR(item : accessor [, namedArgs])$ … $CMS_END_FOR$}. {@code args} only means
     * something when {@code accessor} is a {@code nav:} reference ({@code depth}, {@code
     * channel}, mirroring {@link Navigation}'s own named args) — ignored for a plain list/editor
     * accessor.
     */
    record For(String variable, Accessor accessor, List<NamedArg> args, List<OctlNode> body, int line, int col)
            implements OctlNode {
        public For {
            args = args == null ? List.of() : List.copyOf(args);
            body = body == null ? List.of() : List.copyOf(body);
        }
    }

    /** {@code $CMS_SET(name = expr)$}. */
    record Set(String name, Expr expr, int line, int col) implements OctlNode {}

    /** {@code $CMS_META(key)$} with an optional filter chain (for example {@code now | date("yyyy")}). */
    record Meta(Accessor accessor, List<FilterNode> filters, int line, int col) implements OctlNode {
        public Meta {
            filters = filters == null ? List.of() : List.copyOf(filters);
        }
    }

    /** {@code $CMS_COMMENT$ … $CMS_END_COMMENT$} (content discarded). */
    record Comment(int line, int col) implements OctlNode {}
}
