package com.acme.staticforge.asset.folder;

import com.acme.staticforge.common.JsonUtil;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * A {@code NAVIGATION}-scoped folder's own {@code startNode} — the direct child (a
 * {@code PAGE_REFERENCE} asset or a nested nav folder) that makes the folder itself
 * clickable/linkable when the tree is rendered. {@code null} means the folder is a pure
 * grouping node with no page of its own (spec §17, `M8.1.2`).
 *
 * <p>This is a nav-store pointer only — resolving it walks the navigation tree, never the
 * page store. It must never be conflated with {@code PageReferenceTarget}, which is the
 * opposite: a page-store pointer held by a {@code PAGE_REFERENCE} leaf.
 */
public record StartNode(StartNodeKind kind, UUID assetUuid) {

    /** Reads the {@code startNode} field from a navigation folder's payload, or {@code null} if absent/null. */
    public static StartNode fromPayload(JsonNode payload) {
        if (payload == null) {
            return null;
        }
        JsonNode node = payload.get("startNode");
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        String kind = JsonUtil.text(node, "kind").orElse(null);
        String assetUuid = JsonUtil.text(node, "assetUuid").orElse(null);
        if (kind == null || assetUuid == null) {
            return null;
        }
        try {
            return new StartNode(StartNodeKind.valueOf(kind), UUID.fromString(assetUuid));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
