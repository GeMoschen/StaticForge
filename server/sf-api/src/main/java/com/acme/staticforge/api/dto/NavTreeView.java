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
        boolean protectedFolder,
        long revision,
        List<NavTreeView> children,
        java.util.Map<String, LocaleReleaseView> release,
        java.util.List<ScheduledRefView> scheduled) {}
