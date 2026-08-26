package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.template.render.Filters;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * The default {@code $CMS_NAVIGATION(...)$} markup: a nested {@code <ul>/<li>} list built from
 * the {@link NavigationTreeJson} shape (`M8.1.4`). A grouping-only node (no {@code href}) renders
 * as a non-linked {@code <span>} rather than an anchor (spec §17.2, "a folder with no startNode
 * renders as a non-linked grouping"). {@code active}/{@code trail} become CSS classes on the
 * {@code <li>}, matching the old §17.2 step 5 semantics.
 *
 * <p>{@link #renderChildren} is also the exact body of
 * {@code BlockResolver#renderNavigationRecurse}'s default implementation in both render callers —
 * kept as one shared, stateless utility (rather than duplicated in {@code GenerationRenderer} and
 * {@code PageRenderService}) since the two callers must never visually diverge.
 */
public final class NavigationHtmlRenderer {

    private NavigationHtmlRenderer() {}

    /** Renders the navigation folder's top-level list (the root node's children). */
    public static String renderRoot(JsonNode root) {
        return renderChildren(root);
    }

    /** Renders {@code node}'s children as a nested {@code <ul>}; {@code ""} when it has none. */
    public static String renderChildren(JsonNode node) {
        JsonNode children = node == null ? null : node.path("children");
        if (children == null || !children.isArray() || children.isEmpty()) {
            return "";
        }
        StringBuilder out = new StringBuilder("<ul class=\"nav\">");
        for (JsonNode child : children) {
            out.append(renderItem(child));
        }
        out.append("</ul>");
        return out.toString();
    }

    private static String renderItem(JsonNode node) {
        boolean active = node.path("active").asBoolean(false);
        boolean trail = node.path("trail").asBoolean(false);

        StringBuilder cssClass = new StringBuilder("nav-item");
        if (active) {
            cssClass.append(" active");
        }
        if (trail) {
            cssClass.append(" trail");
        }

        String label = Filters.escapeHtml(node.path("label").asText(""));
        JsonNode hrefNode = node.path("href");
        String href = hrefNode.isTextual() && !hrefNode.asText().isBlank() ? hrefNode.asText() : null;

        StringBuilder out = new StringBuilder();
        out.append("<li class=\"").append(cssClass).append("\">");
        if (href != null) {
            out.append("<a href=\"").append(Filters.escapeAttr(href)).append("\">").append(label).append("</a>");
        } else {
            out.append("<span>").append(label).append("</span>");
        }
        out.append(renderChildren(node));
        out.append("</li>");
        return out.toString();
    }
}
