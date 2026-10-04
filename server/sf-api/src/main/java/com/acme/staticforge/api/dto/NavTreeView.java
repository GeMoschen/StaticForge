package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/**
 * One node of the resolved navigation tree (§ M8.1.5), mirroring
 * {@code com.acme.staticforge.asset.navigation.NavTreeNode} but adding the resolved page's
 * canonical path (there is no URL registry yet, so this is the same {@code folderPath}
 * value the Pages API exposes — M8.2 will replace this with a real URL). {@code type} is
 * {@code FOLDER} or {@code PAGE_REFERENCE}; {@code resolvedPageUuid}/{@code resolvedPagePath}
 * are both {@code null} for a grouping-only folder or an unresolvable/dangling target.
 * {@code resolvedPageName} is that page's display name (M35.22: the menu shows "Company → page name").
 * {@code visibleInMenu} is the "Visible in menu" flag (absent in storage = {@code true}): the tree lists hidden items too,
 * generated menus leave them out.
 * {@code startNode} is a folder's entry page pointer (a direct child, see {@code FolderService#updateStartNode}), absent
 * for items and for grouping-only folders.
 * {@code revision} is the node's current revision, sent back as {@code If-Match} on a rename.
 */
public record NavTreeView(
        UUID uuid,
        String type,
        String uid,
        String displayName,
        String label,
        UUID resolvedPageUuid,
        String resolvedPagePath,
        String resolvedPageName,
        boolean protectedFolder,
        boolean visibleInMenu,
        NavigationStartNodeView startNode,
        long revision,
        List<NavTreeView> children,
        java.util.Map<String, LocaleReleaseView> release,
        java.util.List<ScheduledRefView> scheduled) {}
