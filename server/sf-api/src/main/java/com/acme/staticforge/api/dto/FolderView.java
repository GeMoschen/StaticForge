package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/**
 * A folder node in the tree view. {@code scope} is {@code PAGES}, {@code MEDIA},
 * {@code NAVIGATION}, or {@code TEMPLATES} — each store's folder tree is entirely separate.
 * {@code protectedFolder} is {@code true} only for a folder that can never be renamed, moved,
 * or deleted (currently: the two fixed {@code TEMPLATES} roots).
 *
 * <p>{@code type} is {@code FOLDER}, or {@code RECORD_SET} for a record set in the {@code CONTENT} tree
 * (M25): a leaf whose {@code recordCount} is its live record count ({@code null} for folders).
 * {@code revision} is the node's current revision, sent back as {@code If-Match} on a rename.
 */
public record FolderView(
        UUID uuid,
        String uid,
        String displayName,
        String path,
        String scope,
        boolean protectedFolder,
        String type,
        Long recordCount,
        long revision,
        List<FolderView> children,
        java.util.Map<String, LocaleReleaseView> release,
        java.util.List<ScheduledRefView> scheduled) {}
