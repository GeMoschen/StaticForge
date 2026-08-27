package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/**
 * A folder node in the tree view. {@code scope} is {@code PAGES}, {@code MEDIA},
 * {@code NAVIGATION}, or {@code TEMPLATES} — each store's folder tree is entirely separate.
 * {@code protectedFolder} is {@code true} only for a folder that can never be renamed, moved,
 * or deleted (currently: the two fixed {@code TEMPLATES} roots).
 */
public record FolderView(
        UUID uuid, String uid, String displayName, String path, String scope, boolean protectedFolder, List<FolderView> children) {}
