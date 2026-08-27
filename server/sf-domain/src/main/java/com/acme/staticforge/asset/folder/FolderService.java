package com.acme.staticforge.asset.folder;

import com.acme.staticforge.asset.AssetType;
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

    /** All current folders of {@code scope} in the project, nested as a tree up to {@code depth} ({@code -1} = unlimited). */
    List<FolderNode> tree(long projectId, FolderScope scope, int depth, RevisionContext ctx);

    /**
     * Creates a folder under {@code parentFolderUuid} (root when null). {@code scope} is
     * required at the root; a subfolder inherits its parent's scope (an explicit scope that
     * disagrees with the parent's is rejected).
     */
    AssetVersionView create(UUID parentFolderUuid, String displayName, FolderScope scope, RevisionContext ctx);

    /**
     * Creates a folder with an explicit {@code templateKind} (spec M13.1.2, {@code TEMPLATES}
     * scope only). A subfolder without an explicit {@code templateKind} inherits its parent's;
     * an explicit one that disagrees with the parent's is rejected. Creating directly at the
     * {@code TEMPLATES} scope's top level ({@code parentFolderUuid == null}) is always rejected
     * — that level is fixed to the two auto-provisioned, protected folders.
     */
    AssetVersionView create(
            UUID parentFolderUuid, String displayName, FolderScope scope, AssetType templateKind, RevisionContext ctx);

    /** Renames a folder (display name only — the path is UID-bound and unchanged). */
    AssetVersionView update(UUID uuid, String displayName, long expectedRevision, RevisionContext ctx);

    /**
     * Sets or clears a {@code NAVIGATION}-scoped folder's {@code startNode}. {@code startNode}
     * {@code null} clears it (pure grouping node). A non-null {@code startNode} must reference a
     * direct child of this same folder whose asset type matches the declared kind — rejected
     * otherwise. Rejected outright for folders outside the {@code NAVIGATION} scope.
     */
    AssetVersionView updateStartNode(UUID uuid, StartNode startNode, long expectedRevision, RevisionContext ctx);

    /** Moves a folder and rewrites the entire subtree's paths in a single revision. */
    MoveResult move(UUID folderUuid, UUID targetParentFolderUuid, RevisionContext ctx);

    /** Soft-deletes a folder; blocked while non-empty unless {@code cascade} is true. */
    void delete(UUID uuid, boolean cascade, RevisionContext ctx);
}
