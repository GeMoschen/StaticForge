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

    /**
     * All current folders of {@code scope} in the project, nested as a tree up to {@code depth} ({@code -1} =
     * unlimited). In the {@code CONTENT} scope a folder's record sets are leaf nodes with their live record count (M25).
     */
    List<FolderNode> tree(long projectId, FolderScope scope, int depth, RevisionContext ctx);

    /**
     * {@link #tree} as of revision {@code revision} (time travel): the folders (and record sets) live then — those
     * deleted since included, those created later left out — with their names, uids, paths, parents and record counts
     * as of then.
     */
    List<FolderNode> treeAt(long projectId, FolderScope scope, int depth, long revision);

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

    /**
     * Stores the order of a {@code NAVIGATION} folder's children (M35.22): the menu shows them in this order, ahead of
     * any child the list does not name (those follow alphabetically), and entries that are no longer children are
     * ignored — so moving, deleting or creating children never needs a second write. Every uuid must be a direct
     * child of this folder and appear once; the list may be partial (and empty, which clears the stored order).
     * One new revision of the folder, so it is undone by writing the previous list. Rejected for folders outside the
     * {@code NAVIGATION} scope.
     */
    AssetVersionView updateChildOrder(UUID uuid, java.util.List<UUID> childUuids, long expectedRevision, RevisionContext ctx);

    /**
     * Sets a {@code NAVIGATION} folder's "Visible in menu" flag ({@link MenuVisibility}): a hidden folder is left out
     * of generated menus with everything below it; the editor still lists it and its entry page still resolves.
     * One new revision of the folder. Rejected for folders outside the {@code NAVIGATION} scope, and for the protected
     * root (it is no menu entry).
     */
    AssetVersionView updateVisibleInMenu(UUID uuid, boolean visibleInMenu, long expectedRevision, RevisionContext ctx);

    /** Moves a folder and rewrites the entire subtree's paths in a single revision. */
    MoveResult move(UUID folderUuid, UUID targetParentFolderUuid, RevisionContext ctx);

    /**
     * Soft-deletes a folder — or a record set (M25), whose subtree is its records — in one revision; blocked
     * while non-empty unless {@code cascade} is true ({@code 409 SF-DOM-0110}, with {@code recordCount} for a set).
     */
    void delete(UUID uuid, boolean cascade, RevisionContext ctx);

    /**
     * Undoes {@link #delete} of a folder: the folder and everything that very delete revision took with it (sub-folders,
     * pages, media, navigation entries, templates, record sets with their records) come back as they were, in one new
     * revision and atomically — all or nothing. What was restored on its own since, or deleted by another revision,
     * stays as it is. Paths are rebuilt under the parent's current path. Errors: {@code 404} unknown,
     * {@code 409 SF-DOM-0111} not deleted, {@code 409 SF-DOM-0112} parent folder deleted (restore it first),
     * {@code 409 SF-DOM-0113} a live folder holds the path now.
     */
    AssetVersionView restore(UUID uuid, RevisionContext ctx);
}
