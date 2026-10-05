package com.acme.staticforge.asset.transfer;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.revision.RevisionContext;

/**
 * Duplicates the assets of one type ({@link AssetTransferService} picks the bean by {@link #type()}). A copy is
 * a new asset (new uuid, derived uid) in {@code target}, an unreleased draft with the source's content, named
 * {@link DuplicateTarget#copyName}. It runs in the caller's transaction and fails without writing anything.
 */
public interface AssetDuplicator {

    AssetType type();

    /** @param source the live, current version of the asset to copy */
    AssetVersionView duplicate(AssetVersionView source, DuplicateTarget target, RevisionContext ctx);
}
