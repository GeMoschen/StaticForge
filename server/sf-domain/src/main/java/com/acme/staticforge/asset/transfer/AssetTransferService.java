package com.acme.staticforge.asset.transfer;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.MoveResult;
import com.acme.staticforge.revision.RevisionContext;
import java.util.UUID;

/**
 * Copy and move of assets, the one backend for Copy/Duplicate and Move/Cut. Duplication is per asset type
 * ({@link AssetDuplicator}); move delegates to the existing logic ({@code AssetService.move},
 * {@code FolderService.move}) unchanged.
 */
public interface AssetTransferService {

    /**
     * Copies a live asset into {@code targetFolderUuid} ({@code null}: its own folder) as a new, unreleased draft
     * named "&lt;name&gt; copy" ("copy 2", ...) — unique within the target — in the caller's one transaction, so a
     * failure writes nothing.
     *
     * @throws com.acme.staticforge.common.SfException {@code 404} for an unknown or deleted asset or target,
     *     {@code 422} for a folder or a type without a duplicator, and whatever the containment rules of the
     *     target say ({@code 422 SF-DOM-0104})
     */
    AssetVersionView duplicate(UUID uuid, UUID targetFolderUuid, RevisionContext ctx);

    /** The uuid of the folder (or record set) holding {@code asset}; {@code null} for a root-level one. */
    UUID parentUuid(AssetVersionView asset);

    /** Moves an asset or a folder; exactly one of the outcome's parts is set. */
    MoveOutcome move(UUID uuid, UUID targetFolderUuid, RevisionContext ctx);

    /** {@code asset} for a moved asset, {@code folder} for a moved folder. */
    record MoveOutcome(AssetVersionView asset, MoveResult folder) {}
}
