package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
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
 * <p>Each node gets: {@code assetUuid, type, uid, displayName, label, visibleInMenu, resolvedPageUuid,
 * href, active, trail, children[]}. {@code active} marks the node that IS the page being rendered;
 * {@code trail} marks an ancestor of that page in the resolved tree (never both at once) — the
 * same semantics the deleted grammar's §17.2 step 5 used. {@code href} is {@code null} for a
 * grouping-only node (no {@code resolvedPageUuid}) — callers must not render it as a link.
 *
 * <p>An item whose "Visible in menu" flag is off ({@link NavTreeNode#visibleInMenu()}) is hidden from the menu: it is
 * left out of its parent's {@code children[]} together with its whole subtree, so neither the default HTML nor a
 * template iterating the nodes ever sees it (and it never makes an ancestor part of the {@code trail}). The root passed
 * to {@link #toJson} is always built — it is the folder the template asked for. The flag only concerns menus: the
 * entry-page chain ({@code NavigationService#resolveFolderEntry}) and {@link #danglingPageReferences} still see every node.
 */
public final class NavigationTreeJson {

    private NavigationTreeJson() {}

    /**
     * @param root the resolved tree (from {@code NavigationService#tree})
     * @param currentPageUuid the page being rendered, or {@code null} outside a page context
     * @param hrefResolver resolves a node's href from the whole node (not just its
     *     {@code resolvedPageUuid}) — the {@code PAGE_REFERENCE} identity (`node.assetUuid()`) is
     *     what {@code M8.2.3}'s {@code UrlRegistryService.resolve(pageReferenceUuid, ...)} keys
     *     off of, which a bare page uuid cannot supply. See {@code GenerationRenderer#navHref}/
     *     {@code PageRenderService#navHref} for the current implementation: a {@code
     *     PAGE_REFERENCE} node routes through the URL registry (keyed on {@code node.assetUuid()});
     *     a {@code FOLDER} entry-point node (whose {@code resolvedPageUuid} comes from walking a
     *     {@code startNode} chain, not from a {@code PageReference} the folder itself owns) keeps
     *     resolving its href directly, since the registry has no {@code PageReference} identity to
     *     key a folder's own href on.
     */
    public static ObjectNode toJson(NavTreeNode root, UUID currentPageUuid, Function<NavTreeNode, String> hrefResolver) {
        return build(root, currentPageUuid, hrefResolver);
    }

    /**
     * The {@code assetUuid} of every {@code PAGE_REFERENCE} node (anywhere in the tree) whose
     * {@code resolvedPageUuid} is {@code null} — a dangling reference that bypassed `M8.1.2`
     * validation (or whose target was soft-deleted afterward). Distinct from a grouping-only
     * {@code FOLDER} node with no {@code startNode}, which is a legitimate, intentional
     * non-{@code href} state, not an error.
     */
    public static List<UUID> danglingPageReferences(NavTreeNode root) {
        List<UUID> out = new ArrayList<>();
        collectDangling(root, out);
        return out;
    }

    private static void collectDangling(NavTreeNode node, List<UUID> out) {
        if (node == null) {
            return;
        }
        if (node.type() == AssetType.PAGE_REFERENCE && node.resolvedPageUuid() == null) {
            out.add(node.assetUuid());
        }
        for (NavTreeNode child : node.children()) {
            collectDangling(child, out);
        }
    }

    private static ObjectNode build(NavTreeNode node, UUID currentPageUuid, Function<NavTreeNode, String> hrefResolver) {
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
            if (!child.visibleInMenu()) {
                continue;
            }
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
        json.put("visibleInMenu", node.visibleInMenu());
        json.put("resolvedPageUuid", resolvedPageUuid == null ? null : resolvedPageUuid.toString());
        String href = resolvedPageUuid == null || hrefResolver == null ? null : hrefResolver.apply(node);
        json.put("href", href);
        json.put("active", active);
        json.put("trail", !active && descendantOnTrail);
        json.set("children", children);
        return json;
    }
}
