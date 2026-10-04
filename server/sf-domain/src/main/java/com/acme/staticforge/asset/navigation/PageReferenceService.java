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

    /**
     * Updates the reference; in a project with locales the label is language-dependent (M24.2.2)
     * and {@code locale} says which language this write sets, leaving the others untouched
     * ({@code null} means the project's default language).
     */
    AssetVersionView update(
            UUID uuid,
            PageReferenceTargetKind targetKind,
            UUID targetAssetUuid,
            String label,
            String locale,
            long expectedRevision,
            RevisionContext ctx);

    /**
     * Like {@link #update(UUID, PageReferenceTargetKind, UUID, String, String, long, RevisionContext)}, also setting the
     * "Visible in menu" flag when {@code visibleInMenu} is non-null ({@code null} leaves it as stored). One revision.
     */
    AssetVersionView update(
            UUID uuid,
            PageReferenceTargetKind targetKind,
            UUID targetAssetUuid,
            String label,
            String locale,
            Boolean visibleInMenu,
            long expectedRevision,
            RevisionContext ctx);

    /**
     * Sets only the "Visible in menu" flag ({@code MenuVisibility}) of a reference, leaving its target and label
     * untouched. One revision (a no-op write is still one revision, like any other update).
     */
    AssetVersionView setVisibleInMenu(UUID uuid, boolean visibleInMenu, long expectedRevision, RevisionContext ctx);

    AssetVersionView find(long projectId, UUID uuid);
}
