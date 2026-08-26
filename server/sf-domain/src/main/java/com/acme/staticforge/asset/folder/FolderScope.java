package com.acme.staticforge.asset.folder;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.common.JsonUtil;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * Which store a folder belongs to. The pages tree and the media library each have their
 * own, entirely separate folder hierarchy — a folder created in one never appears, and
 * cannot be moved into or hold assets, from the other.
 */
public enum FolderScope {
    PAGES,
    MEDIA,
    NAVIGATION;

    /** The scope an asset of this type must be placed under, or {@code null} if the type isn't scoped to a store. */
    public static FolderScope requiredFor(AssetType type) {
        return switch (type) {
            case PAGE -> PAGES;
            case MEDIA -> MEDIA;
            case PAGE_REFERENCE -> NAVIGATION;
            default -> null;
        };
    }

    /** Reads the {@code scope} field from a folder asset's payload, or {@code null} if absent/unrecognized (e.g. the internal root sentinel). */
    public static FolderScope fromPayload(JsonNode payload) {
        return JsonUtil.text(payload, "scope").map(text -> {
            try {
                return FolderScope.valueOf(text);
            } catch (IllegalArgumentException e) {
                return null;
            }
        }).orElse(null);
    }
}
