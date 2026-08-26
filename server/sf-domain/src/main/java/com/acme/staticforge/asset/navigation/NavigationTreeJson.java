package com.acme.staticforge.asset.navigation;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.UUID;
import java.util.function.Function;

/**
 * Converts a resolved {@link NavTreeNode} tree into the {@code JsonNode} shape consumed by
 * {@code BlockResolver#renderNavigationRecurse} and {@link NavigationHtmlRenderer} (`M8.1.4`).
 * {@code BlockResolver} lives in {@code sf-template}, which must stay free of a {@code sf-domain}
 * dependency, so the typed {@link NavTreeNode} never crosses that boundary directly — this is the
 * one place a tree gets flattened into the generic {@code JsonNode} shape (mirrors how a CATALOG
 * editor's {@code cards} array is passed to {@code BlockResolver#renderCatalog} as plain JSON).
 *
 * <p>Each node gets: {@code assetUuid, type, uid, displayName, label, resolvedPageUuid, href,
 * active, trail, children[]}. {@code active} marks the node that IS the page being rendered;
 * {@code trail} marks an ancestor of that page in the resolved tree (never both at once) — the
 * same semantics the deleted grammar's §17.2 step 5 used. {@code href} is {@code null} for a
 * grouping-only node (no {@code resolvedPageUuid}) — callers must not render it as a link.
 */
public final class NavigationTreeJson {

    private NavigationTreeJson() {}

    /**
     * @param root the resolved tree (from {@code NavigationService#tree})
     * @param currentPageUuid the page being rendered, or {@code null} outside a page context
     * @param hrefResolver resolves a node's {@code resolvedPageUuid} to an href; see
     *     {@code GenerationRenderer#navHref}/the preview equivalent for the current (§`M8.1.4`)
     *     straight page-path implementation, spliced out for `M8.2.3`'s URL registry later
     */
    public static ObjectNode toJson(NavTreeNode root, UUID currentPageUuid, Function<UUID, String> hrefResolver) {
        return build(root, currentPageUuid, hrefResolver);
    }

    private static ObjectNode build(NavTreeNode node, UUID currentPageUuid, Function<UUID, String> hrefResolver) {
        ObjectNode json = JsonNodeFactory.instance.objectNode();
        if (node == null) {
            json.putArray("children");
            json.put("active", false);
            json.put("trail", false);
            return json;
        }

        UUID resolvedPageUuid = node.resolvedPageUuid();
        boolean active = resolvedPageUuid != null && resolvedPageUuid.equals(currentPageUuid);

        ArrayNode children = JsonNodeFactory.instance.arrayNode();
        boolean descendantOnTrail = false;
        for (NavTreeNode child : node.children()) {
            ObjectNode childJson = build(child, currentPageUuid, hrefResolver);
            children.add(childJson);
            if (childJson.path("active").asBoolean(false) || childJson.path("trail").asBoolean(false)) {
                descendantOnTrail = true;
            }
        }

        json.put("assetUuid", node.assetUuid() == null ? null : node.assetUuid().toString());
        json.put("type", node.type() == null ? null : node.type().name());
        json.put("uid", node.uid());
        json.put("displayName", node.displayName());
        json.put("label", node.label());
        json.put("resolvedPageUuid", resolvedPageUuid == null ? null : resolvedPageUuid.toString());
        String href = resolvedPageUuid == null || hrefResolver == null ? null : hrefResolver.apply(resolvedPageUuid);
        json.put("href", href);
        json.put("active", active);
        json.put("trail", !active && descendantOnTrail);
        json.set("children", children);
        return json;
    }
}
