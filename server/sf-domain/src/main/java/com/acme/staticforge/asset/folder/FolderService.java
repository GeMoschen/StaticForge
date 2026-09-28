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
     * Sets or clears a {@code PAGES}-scoped folder's start page (M31, {@link StartPage}): the page that renders as the
     * folder's index file. {@code pageUuid} {@code null} clears it. The folder may be protected ({@code pages_root},
     * the site root); the hidden shared root and folders of other stores are refused. A non-null page must be a live
     * page directly in this folder, and no other live page of the folder may claim the index path (its UID equal to a
     * channel's index file stem): {@code 409 SF-DOM-0111} names that page. An unchanged value writes nothing (the
     * revision is still checked).
     */
    AssetVersionView updateStartPage(UUID uuid, UUID pageUuid, long expectedRevision, RevisionContext ctx);

    /** Moves a folder and rewrites the entire subtree's paths in a single revision. */
    MoveResult move(UUID folderUuid, UUID targetParentFolderUuid, RevisionContext ctx);

    /**
     * Soft-deletes a folder — or a record set (M25), whose subtree is its records — in one revision; blocked
     * while non-empty unless {@code cascade} is true ({@code 409 SF-DOM-0110}, with {@code recordCount} for a set).
     */
    void delete(UUID uuid, boolean cascade, RevisionContext ctx);
}
