package com.acme.staticforge.asset.folder;

import org.springframework.stereotype.Component;

/**
 * Pure helper for materialized folder paths (spec §10.2). A folder's {@code folderPath}
 * column holds the folder's own canonical path with a trailing slash ({@code /products/});
 * the same value is denormalized onto descendant rows so subtree queries are a plain
 * prefix lookup. Path segments are asset UIDs, never output paths (§10.2).
 */
@Component
public class PathService {

    public static final String ROOT_PATH = "/";
    public static final String ROOT_UID = "root";
    public static final int MAX_DEPTH = 12;

    /** The canonical root path. */
    public String rootPath() {
        return ROOT_PATH;
    }

    /** Ensures a trailing slash. */
    public String ensureTrailingSlash(String path) {
        if (path == null || path.isBlank()) {
            return ROOT_PATH;
        }
        return path.endsWith("/") ? path : path + "/";
    }

    /**
     * The canonical path of a child folder placed under a parent whose own path is
     * {@code parentPath}. The child's own path appends its UID and a trailing slash.
     */
    public String childPath(String parentPath, String childUid) {
        return ensureTrailingSlash(parentPath) + childUid + "/";
    }

    /** The path of a page (non-folder) placed in a folder: simply the folder's own path. */
    public String contentPath(String folderPath) {
        return ensureTrailingSlash(folderPath);
    }

    /** Folder depth of a path (root is depth 0). */
    public int depth(String path) {
        String p = ensureTrailingSlash(path);
        if (ROOT_PATH.equals(p)) {
            return 0;
        }
        return (int) p.chars().filter(c -> c == '/').count();
    }

    /** True when {@code path} is {@code prefix} itself or lies beneath it. */
    public boolean isUnder(String path, String prefix) {
        String p = ensureTrailingSlash(path);
        String q = ensureTrailingSlash(prefix);
        return p.startsWith(q);
    }

    /** Replaces the {@code oldPrefix} of {@code path} with {@code newPrefix}. */
    public String rebase(String path, String oldPrefix, String newPrefix) {
        String p = ensureTrailingSlash(path);
        String q = ensureTrailingSlash(oldPrefix);
        if (!p.startsWith(q)) {
            throw new IllegalArgumentException("Path " + p + " is not under prefix " + q);
        }
        return ensureTrailingSlash(newPrefix) + p.substring(q.length());
    }
}
