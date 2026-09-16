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
    NAVIGATION,
    TEMPLATES,
    GLOBALS,
    /** The Content store (M19.1.1): dataset records and their folders. */
    CONTENT;

    /**
     * Well-known {@code uid}s of the two fixed, auto-provisioned, protected top-level folders
     * of the {@code TEMPLATES} scope (M13.1.2). Reserved in {@link com.acme.staticforge.asset.UidGenerator}
     * so no user-derived uid can ever collide with them.
     */
    public static final String PAGE_TEMPLATES_UID = "page_templates";

    public static final String SECTION_TEMPLATES_UID = "section_templates";

    /** Well-known {@code uid} of the fixed, auto-provisioned, protected {@code NAVIGATION}-scope
     * root folder — every top-level navigation folder/reference nests under it. */
    public static final String NAVIGATION_ROOT_UID = "navigation_root";

    /** Well-known {@code uid} of the fixed, auto-provisioned, protected {@code TEMPLATES}-scope
     * root folder — the real parent of both {@link #PAGE_TEMPLATES_UID}/{@link #SECTION_TEMPLATES_UID}. */
    public static final String TEMPLATES_ROOT_UID = "templates_root";

    /** Well-known {@code uid} of the fixed, auto-provisioned, protected {@code PAGES}-scope
     * root folder — every top-level page folder/loose page nests under it, mirroring {@link
     * #NAVIGATION_ROOT_UID}. */
    public static final String PAGES_ROOT_UID = "pages_root";

    /** Well-known {@code uid} of the fixed, auto-provisioned, protected {@code MEDIA}-scope
     * root folder — every top-level media folder/loose media asset nests under it, mirroring
     * {@link #NAVIGATION_ROOT_UID}. */
    public static final String MEDIA_ROOT_UID = "media_root";

    /** Well-known {@code uid} of the fixed, auto-provisioned, protected {@code GLOBALS}-scope
     * root folder (M17.1.1) — every top-level Globals folder/loose property set nests under it,
     * mirroring {@link #NAVIGATION_ROOT_UID}. */
    public static final String GLOBALS_ROOT_UID = "globals_root";

    /** Well-known {@code uid} of the fixed, auto-provisioned, protected {@code CONTENT}-scope root
     * folder (M19.1.1) — every top-level Content folder/loose record nests under it, mirroring
     * {@link #GLOBALS_ROOT_UID}. */
    public static final String CONTENT_ROOT_UID = "content_root";

    /** Well-known {@code uid} of the fixed, protected {@code TEMPLATES}-scope folder holding dataset
     * schemas (M19.1.1), the third one next to {@link #PAGE_TEMPLATES_UID}/{@link #SECTION_TEMPLATES_UID}. */
    public static final String DATASETS_UID = "datasets";

    /** The scope an asset of this type must be placed under, or {@code null} if the type isn't scoped to a store. */
    public static FolderScope requiredFor(AssetType type) {
        return switch (type) {
            case PAGE -> PAGES;
            case MEDIA -> MEDIA;
            case PAGE_REFERENCE -> NAVIGATION;
            case PAGE_TEMPLATE, SECTION_TEMPLATE, DATASET -> TEMPLATES;
            case GLOBAL_SET -> GLOBALS;
            case RECORD -> CONTENT;
            default -> null;
        };
    }

    /**
     * The folder uid a {@code nav:<uid>} template reference looks up. {@code nav:root} is the
     * documented way to address the whole navigation tree, so it maps to {@link
     * #NAVIGATION_ROOT_UID} — never to the hidden shared {@code root} folder that parents every
     * store. Every other uid is returned unchanged.
     */
    public static String navigationReferenceUid(String uid) {
        return "root".equals(uid) ? NAVIGATION_ROOT_UID : uid;
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

    /**
     * Reads the {@code templateKind} field from a folder asset's payload ({@code TEMPLATES}
     * scope only) — {@code PAGE_TEMPLATE}, {@code SECTION_TEMPLATE} or {@code DATASET} — or {@code null} if
     * absent/unrecognized.
     */
    public static AssetType templateKindFromPayload(JsonNode payload) {
        return JsonUtil.text(payload, "templateKind").map(text -> {
            try {
                return AssetType.valueOf(text);
            } catch (IllegalArgumentException e) {
                return null;
            }
        }).orElse(null);
    }

    /**
     * Reads the generic {@code protected} flag from a folder asset's payload (M13.1.1):
     * {@code true} only for the two fixed {@code TEMPLATES}-scope roots, absent/{@code false}
     * for every ordinary folder.
     */
    public static boolean isProtected(JsonNode payload) {
        return payload != null && payload.path("protected").asBoolean(false);
    }
}
