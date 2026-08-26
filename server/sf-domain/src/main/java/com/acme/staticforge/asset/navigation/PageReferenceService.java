package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.revision.RevisionContext;
import java.util.UUID;

/**
 * {@code PAGE_REFERENCE} operations (spec §17, `M8.1.2`). A page reference is a fixed-shape
 * pointer asset, not content — there is no CDL involved, only structural validation of its
 * {@code target}. All mutations route through the generic {@code AssetService} and are
 * revision-aware and optimistic-concurrency-checked, exactly like every other asset type.
 */
public interface PageReferenceService {

    AssetVersionView create(CreatePageReferenceCommand cmd, RevisionContext ctx);

    AssetVersionView update(
            UUID uuid,
            PageReferenceTargetKind targetKind,
            UUID targetAssetUuid,
            String label,
            long expectedRevision,
            RevisionContext ctx);

    AssetVersionView find(long projectId, UUID uuid);
}
