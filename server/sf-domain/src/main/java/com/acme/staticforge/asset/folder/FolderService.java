package com.acme.staticforge.asset.folder;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.revision.RevisionContext;
import java.util.List;
import java.util.UUID;

/**
 * Folder operations over the revisioned folder-asset model (spec §10.2). Folders are
 * {@code FOLDER} assets whose materialized path lives on {@code AssetVersion.folderPath}
 * and is denormalized onto descendants for subtree queries.
 */
public interface FolderService {

    /** All current folders in the project, nested as a tree up to {@code depth} ({@code -1} = unlimited). */
    List<FolderNode> tree(long projectId, int depth, RevisionContext ctx);

    /** Creates a folder under {@code parentFolderUuid} (root when null). */
    AssetVersionView create(UUID parentFolderUuid, String displayName, RevisionContext ctx);

    /** Renames a folder (display name only — the path is UID-bound and unchanged). */
    AssetVersionView update(UUID uuid, String displayName, long expectedRevision, RevisionContext ctx);

    /** Moves a folder and rewrites the entire subtree's paths in a single revision. */
    MoveResult move(UUID folderUuid, UUID targetParentFolderUuid, RevisionContext ctx);

    /** Soft-deletes a folder; blocked while non-empty unless {@code cascade} is true. */
    void delete(UUID uuid, boolean cascade, RevisionContext ctx);
}
