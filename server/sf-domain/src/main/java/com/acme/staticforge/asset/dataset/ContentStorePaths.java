package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.template.query.RecordView;

/**
 * Converts between a record's stored folder path and the Content-store-relative path templates, the
 * query model and the REST listing use (M19.3.1). Folder paths are uid-based and every store root
 * sits directly under the hidden root, so the Content store root is always {@code /content_root/}:
 * a record stored in {@code /content_root/team/leads/} is at {@code /team/leads/}.
 */
public final class ContentStorePaths {

    /** The stored folder path of the Content store root. */
    public static final String ROOT = "/" + FolderScope.CONTENT_ROOT_UID + "/";

    private ContentStorePaths() {}

    /** {@code /content_root/team/} → {@code /team/}; a path outside the store is returned normalized. */
    public static String relative(String storedFolderPath) {
        String path = RecordView.normalizeFolder(storedFolderPath);
        return path.startsWith(ROOT) ? path.substring(ROOT.length() - 1) : path;
    }

    /** {@code team} or {@code /team/} → {@code /content_root/team/}. */
    public static String stored(String relativeFolderPath) {
        String path = RecordView.normalizeFolder(relativeFolderPath);
        return ROOT + path.substring(1);
    }
}
