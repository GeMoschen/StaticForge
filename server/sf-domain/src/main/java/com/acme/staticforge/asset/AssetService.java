package com.acme.staticforge.asset;

import com.acme.staticforge.revision.RevisionContext;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * Generic asset operations shared by every asset type (spec §21.3). Every mutating method
 * goes through {@link com.acme.staticforge.revision.RevisionService#allocate} and the
 * version-interval write algorithm (§7.4), carrying an explicit {@link RevisionContext}.
 */
public interface AssetService {

    /** Creates a new asset, assigns a UUID and UID, and inserts the first version at a fresh revision. */
    AssetVersionView create(CreateAssetCommand cmd, RevisionContext ctx);

    /** Lazily ensures the project's implicit root folder ({@code uid=root}, {@code path=/}). */
    AssetVersionView ensureRootFolder(long projectId, RevisionContext ctx);

    /** Applies a full state change, closing the current version and opening a new one. Optimistic-concurrency-checked. */
    AssetVersionView update(UUID uuid, UpdateAssetCommand cmd, long expectedRevision, RevisionContext ctx);

    /** Marks the asset deleted via a {@code deleted=true} version row (nothing physically removed). */
    void softDelete(UUID uuid, boolean force, RevisionContext ctx);

    /** Writes the payload/display name of the version valid at {@code fromRevision} as a new (append-only) revision. */
    AssetVersionView restore(UUID uuid, long fromRevision, RevisionContext ctx);

    /** The version valid at {@code revision}, or empty when the asset did not exist yet. */
    Optional<AssetVersionView> findAt(UUID uuid, long revision);

    /** The asset's current (open) version, or throws 404. */
    AssetVersionView requireCurrent(UUID uuid);

    /** Current-version summaries filtered by project/type/folder and a display-name substring. */
    Page<AssetSummary> search(AssetQuery query, Pageable pageable);

    /** Inbound {@link AssetReference}s, resolved to the referring asset's identity. */
    List<UsageView> usages(UUID uuid);

    /** All versions of the asset, newest first. */
    List<AssetVersionView> history(UUID uuid);

    /**
     * Explicit UID rename (spec §6.4): validates, allocates a revision, records history and updates
     * {@code asset.uid}. Returns the old/new UID plus the informational list of OCTL templates that
     * still reference the old UID literally.
     */
    UidChangeResult changeUid(UUID uuid, String newUid, RevisionContext ctx);

    /** Moves a non-folder asset into another folder (folder subtree moves go through {@link com.acme.staticforge.asset.folder.FolderService}). */
    AssetVersionView move(UUID uuid, UUID newParentFolderUuid, RevisionContext ctx);
}
