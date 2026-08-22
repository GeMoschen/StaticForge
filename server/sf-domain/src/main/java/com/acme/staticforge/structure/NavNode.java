package com.acme.staticforge.structure;

import java.util.List;
import java.util.UUID;

/**
 * One immutable, computed navigation node (spec §17.2). Carries the renderer-facing fields
 * ({@code label}, {@code href}, {@code active}, {@code trail}, {@code level}) plus the
 * page identity ({@code pageUuid}, {@code pageUid}, {@code displayName}) and nested
 * {@code children}.
 */
public record NavNode(
        String label,
        String href,
        boolean active,
        boolean trail,
        int level,
        List<NavNode> children,
        UUID pageUuid,
        String pageUid,
        String displayName) {

    public NavNode {
        children = children == null ? List.of() : List.copyOf(children);
    }
}
