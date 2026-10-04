package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.asset.AssetType;
import java.util.List;
import java.util.UUID;

/**
 * One node of a resolved navigation tree (spec §17, `M8.1.3`), mirroring the shape (not the
 * class) of the deleted {@code NavNode}. Nodes are either a {@code FOLDER} (nav-store) or a
 * {@code PAGE_REFERENCE} leaf; {@code resolvedPageUuid} is the Page this node ultimately points
 * at ({@link NavigationService#resolveFolderEntry} for a folder, {@link NavigationService#resolve}
 * for a page reference), or {@code null} when the node has no entry page (a grouping-only folder
 * with no {@code startNode}, or an unresolvable/dangling target). Computing a URL from that uuid
 * is out of scope here (`M8.1.4`/`M8.1.5`'s job) — this only proves/exposes the resolved page.
 *
 * <p>{@code visibleInMenu} is the item's "Visible in menu" flag ({@code MenuVisibility}; absent = {@code true}). The
 * tree carries every node, hidden or not (the editor lists them all); {@link NavigationTreeJson} leaves a hidden node
 * and its subtree out of the menus templates render.
 */
public record NavTreeNode(
        UUID assetUuid,
        AssetType type,
        String uid,
        String displayName,
        String label,
        UUID resolvedPageUuid,
        boolean protectedFolder,
        boolean visibleInMenu,
        List<NavTreeNode> children) {

    public NavTreeNode {
        children = children == null ? List.of() : List.copyOf(children);
    }

    /** A node that is visible in the menu. */
    public NavTreeNode(
            UUID assetUuid,
            AssetType type,
            String uid,
            String displayName,
            String label,
            UUID resolvedPageUuid,
            boolean protectedFolder,
            List<NavTreeNode> children) {
        this(assetUuid, type, uid, displayName, label, resolvedPageUuid, protectedFolder, true, children);
    }
}
