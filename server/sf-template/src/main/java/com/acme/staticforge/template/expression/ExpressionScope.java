package com.acme.staticforge.template.expression;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashMap;
import java.util.Map;

/**
 * What the identifiers of an expression read (M33.1): the root names — a definition's editor values and the named roots
 * the rule engine provides ({@code value}, {@code item}, {@code index}, {@code parent}, {@code locale},
 * {@code defaultLocale}, {@code page}/{@code record}/{@code global}/{@code section}, {@code release}, {@code body}) —
 * and {@code global:<set>} property sets. A name the scope doesn't know reads as {@code null}.
 */
public interface ExpressionScope {

    /** The value of the root identifier {@code name}, or {@code null} when the scope has none. */
    JsonNode root(String name);

    /** The values of the global property set {@code setUid} ({@code global:<set>.<field>}), or {@code null}. */
    default JsonNode global(String setUid) {
        return null;
    }

    /** A scope over one JSON object: each field is a root (the {@code visibleWhen} scope). */
    static ExpressionScope of(JsonNode values) {
        return name -> values == null || !values.isObject() ? null : values.get(name);
    }

    /** This scope with extra named roots that shadow its own. */
    default ExpressionScope with(Map<String, JsonNode> roots) {
        ExpressionScope base = this;
        Map<String, JsonNode> copy = new HashMap<>(roots);
        return new ExpressionScope() {
            @Override
            public JsonNode root(String name) {
                return copy.containsKey(name) ? copy.get(name) : base.root(name);
            }

            @Override
            public JsonNode global(String setUid) {
                return base.global(setUid);
            }
        };
    }
}
