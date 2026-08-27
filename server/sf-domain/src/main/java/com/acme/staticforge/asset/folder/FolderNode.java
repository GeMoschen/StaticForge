package com.acme.staticforge.asset.folder;

import java.util.List;
import java.util.UUID;

/**
 * A folder node in the materialized tree. {@code protectedFolder} mirrors the {@code protected}
 * payload flag (M13.1.1): a protected folder can never be renamed, moved, or deleted, though
 * folders/assets created beneath it are ordinary and unprotected themselves.
 */
public record FolderNode(
        UUID uuid, String uid, String displayName, String path, FolderScope scope, boolean protectedFolder, List<FolderNode> children) {}
