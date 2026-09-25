package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.folder.FolderScope;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.EnumSet;
import java.util.Set;

/**
 * Which assets carry a release state (M27.1.1, epic decision 1) — the single place that encodes it.
 *
 * <p>Editorial content is released: pages, records, record sets, global sets, media, navigation page references and
 * the folders of the editorial stores. Templates, dataset schemas, template-store folders and everything that is not
 * an asset (channels, targets, locales, project settings) stay live: a build renders their version at the build
 * revision.
 *
 * <p>The fixed store roots ({@code pages_root}, {@code media_root}, …, and the hidden shared {@code root}) are not
 * released: they are protected, never edited, and always there, so a release pointer would only add rows every
 * "ancestor folder" check has to skip.
 */
public final class ReleasableTypes {

    private static final Set<AssetType> CONTENT_TYPES = EnumSet.of(
            AssetType.PAGE,
            AssetType.RECORD,
            AssetType.RECORD_SET,
            AssetType.GLOBAL_SET,
            AssetType.MEDIA,
            AssetType.PAGE_REFERENCE);

    private static final Set<FolderScope> EDITORIAL_SCOPES = EnumSet.of(
            FolderScope.PAGES, FolderScope.MEDIA, FolderScope.NAVIGATION, FolderScope.GLOBALS, FolderScope.CONTENT);

    private static final Set<String> STORE_ROOT_UIDS = Set.of(
            FolderScope.PAGES_ROOT_UID,
            FolderScope.MEDIA_ROOT_UID,
            FolderScope.NAVIGATION_ROOT_UID,
            FolderScope.GLOBALS_ROOT_UID,
            FolderScope.CONTENT_ROOT_UID);

    private ReleasableTypes() {}

    /**
     * {@code true} when an asset of {@code type} carries release pointers. A folder is releasable when it belongs to
     * an editorial store and is not a store root, so its {@code payload} (for the scope) and {@code uid} are needed;
     * both are ignored for every other type.
     */
    public static boolean isReleasable(AssetType type, JsonNode payload, String uid) {
        if (CONTENT_TYPES.contains(type)) {
            return true;
        }
        if (type != AssetType.FOLDER) {
            return false;
        }
        FolderScope scope = FolderScope.fromPayload(payload);
        return scope != null && EDITORIAL_SCOPES.contains(scope) && !STORE_ROOT_UIDS.contains(uid);
    }

    /** The asset types that may carry release pointers (folders only in part, see {@link #isReleasable}). */
    public static Set<AssetType> candidateTypes() {
        Set<AssetType> types = EnumSet.copyOf(CONTENT_TYPES);
        types.add(AssetType.FOLDER);
        return types;
    }
}
