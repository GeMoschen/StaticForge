package com.acme.staticforge.asset.navigation;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Data-access abstraction for {@link NavigationService} (spec §17, `M8.1.3`). The resolution
 * algorithm is written once against this interface; a live-repository implementation
 * ({@code LiveNavigationLookup}, sf-domain) backs preview, and a revision-pinned
 * {@code Snapshot} implementation ({@code SnapshotNavigationLookup}, sf-generate) backs
 * generation — the same dual-path split {@code GenerationRenderer}/{@code PageRenderService}
 * already use for page rendering (`M8.1.4`).
 */
public interface NavigationLookup {

    /** The current, non-deleted asset with this uuid, or empty if missing/deleted. */
    Optional<NavigationAsset> byUuid(UUID uuid);

    /**
     * The direct children of a folder (any asset type — callers filter by {@code type}
     * themselves), in the store's deterministic order for that asset type. Empty (never
     * {@code null}) when {@code folderUuid} is not a live folder or has no children.
     */
    List<NavigationAsset> childrenOf(UUID folderUuid);
}
