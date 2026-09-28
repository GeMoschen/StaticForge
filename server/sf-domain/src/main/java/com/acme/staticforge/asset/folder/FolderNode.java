package com.acme.staticforge.asset.folder;

import com.acme.staticforge.asset.AssetType;
import java.util.List;
import java.util.UUID;

/**
 * A node in the materialized folder tree. {@code protectedFolder} mirrors the {@code protected}
 * payload flag (M13.1.1): a protected folder can never be renamed, moved, or deleted, though
 * folders/assets created beneath it are ordinary and unprotected themselves.
 *
 * <p>{@code type} is {@code FOLDER}, or {@code RECORD_SET} for a record set in the Content store (M25):
 * a leaf node whose {@code recordCount} is its live record count (its records are never tree nodes).
 * {@code recordCount} is {@code null} for folders. {@code revision} is the node's current
 * {@code validFromRevision}, the concurrency token a rename sends back as {@code If-Match}. {@code startPage} is a
 * {@code PAGES} folder's start page pointer ({@link StartPage}, M31) as stored in its draft, {@code null} otherwise.
 */
public record FolderNode(
        UUID uuid,
        String uid,
        String displayName,
        String path,
        FolderScope scope,
        boolean protectedFolder,
        AssetType type,
        Long recordCount,
        long revision,
        UUID startPage,
        List<FolderNode> children) {}
