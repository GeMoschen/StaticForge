package com.acme.staticforge.generate.nav;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.navigation.NavigationAsset;
import com.acme.staticforge.asset.navigation.NavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationServiceImpl;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * {@link NavigationLookup} over a revision-pinned {@link Snapshot} (spec §17, §18.2;
 * `M8.1.3`) — backs generation's read path, mirroring how {@code GenerationRenderer} reads
 * {@code Snapshot} assets rather than the live repositories ({@code LiveNavigationLookup} in
 * sf-domain backs the live/preview path instead). {@code M8.1.4} wires this into the render
 * pipeline; this class only needs to exist here so the dual-path parity acceptance criterion
 * (identical results against a {@code Snapshot} or the live repositories, for the same
 * fixture) can be exercised by this task's tests.
 *
 * <p>Unlike the live path — which has each row's parent folder id right there on
 * {@code AssetVersion.folderId} — a {@link SnapshotAsset} only carries its containing folder's
 * materialized <em>path</em> ({@code folderPath}), the same denormalized string
 * {@code PathService} produces (spec §10.2). {@link #childrenOf} therefore derives the
 * parent/child relationship from path structure: a non-folder asset is a direct child of a
 * folder whose own path equals the asset's {@code folderPath}; a folder asset is a direct
 * child of a folder whose own path equals the candidate's {@code folderPath} with its last
 * path segment removed.
 *
 * <p><b>Release state (M27.2.1).</b> A lookup reads one language view of the snapshot. An asset not released in that
 * language is absent like a tombstone, and a page reference that resolves to nothing <em>only</em> because its
 * target (a page, or every page under a folder target) isn't released there is left out of {@link #childrenOf}: it
 * is absent from that language's navigation (epic decision 17), not a dangling reference ({@code SF-NAV-…}), which
 * would hold the page back.
 */
public final class SnapshotNavigationLookup implements NavigationLookup {

    private final Snapshot snapshot;
    private final boolean includeUnreleased;
    private final NavigationServiceImpl navigation = new NavigationServiceImpl();
    private final Map<UUID, Boolean> hiddenByRelease = new ConcurrentHashMap<>();
    private volatile SnapshotNavigationLookup withUnreleased;

    public SnapshotNavigationLookup(Snapshot snapshot) {
        this(snapshot, false);
    }

    private SnapshotNavigationLookup(Snapshot snapshot, boolean includeUnreleased) {
        this.snapshot = snapshot;
        this.includeUnreleased = includeUnreleased;
    }

    @Override
    public Optional<NavigationAsset> byUuid(long projectId, UUID uuid) {
        // projectId is unused: interface conformance only — a Snapshot is already project-scoped by construction.
        if (uuid == null) {
            return Optional.empty();
        }
        SnapshotAsset asset = snapshot.assetByUuid(uuid);
        if (asset == null || absent(asset)) {
            return Optional.empty();
        }
        return Optional.of(toNavigationAsset(asset));
    }

    @Override
    public List<NavigationAsset> childrenOf(long projectId, UUID folderUuid) {
        // projectId is unused: interface conformance only — a Snapshot is already project-scoped by construction.
        if (folderUuid == null) {
            return List.of();
        }
        SnapshotAsset folder = snapshot.assetByUuid(folderUuid);
        if (folder == null || absent(folder) || folder.type() != AssetType.FOLDER) {
            return List.of();
        }
        String parentPath = ensureTrailingSlash(folder.folderPath());

        return snapshot.byUuid().values().stream()
                .filter(a -> !absent(a))
                .filter(a -> !a.uuid().equals(folderUuid))
                .filter(a -> isDirectChild(a, parentPath))
                .filter(a -> !isHiddenByRelease(a))
                .map(SnapshotNavigationLookup::toNavigationAsset)
                .toList();
    }

    /** Absent from this lookup: a tombstone, or unreleased unless this is the lookup that ignores release state. */
    private boolean absent(SnapshotAsset asset) {
        return asset.deleted() && !(includeUnreleased && asset.unreleased());
    }

    /**
     * A page reference that resolves to nothing here but to a page once unreleased assets count: its target isn't
     * released in this language. Memoized per reference — every page of a build walks the same navigation.
     */
    private boolean isHiddenByRelease(SnapshotAsset asset) {
        if (includeUnreleased || asset.type() != AssetType.PAGE_REFERENCE) {
            return false;
        }
        // Not computeIfAbsent: resolving a folder target walks childrenOf again, which may consult this map.
        Boolean known = hiddenByRelease.get(asset.uuid());
        if (known != null) {
            return known;
        }
        long projectId = snapshot.projectId();
        boolean hidden = navigation.resolve(projectId, asset.uuid(), this) == null
                && navigation.resolve(projectId, asset.uuid(), unreleasedIncluded()) != null;
        hiddenByRelease.put(asset.uuid(), hidden);
        return hidden;
    }

    private SnapshotNavigationLookup unreleasedIncluded() {
        SnapshotNavigationLookup all = withUnreleased;
        if (all == null) {
            all = new SnapshotNavigationLookup(snapshot, true);
            withUnreleased = all;
        }
        return all;
    }

    private static boolean isDirectChild(SnapshotAsset candidate, String parentPath) {
        if (candidate.type() == AssetType.FOLDER) {
            return parentPathOf(ensureTrailingSlash(candidate.folderPath())).equals(parentPath);
        }
        return ensureTrailingSlash(candidate.folderPath()).equals(parentPath);
    }

    /** {@code "/products/electronics/" -> "/products/"}; {@code "/products/" -> "/"}; {@code "/" -> "/"}. */
    private static String parentPathOf(String path) {
        if ("/".equals(path)) {
            return "/";
        }
        String withoutTrailingSlash = path.substring(0, path.length() - 1);
        int idx = withoutTrailingSlash.lastIndexOf('/');
        return idx <= 0 ? "/" : withoutTrailingSlash.substring(0, idx + 1);
    }

    private static String ensureTrailingSlash(String path) {
        if (path == null || path.isBlank()) {
            return "/";
        }
        return path.endsWith("/") ? path : path + "/";
    }

    private static NavigationAsset toNavigationAsset(SnapshotAsset asset) {
        return new NavigationAsset(asset.uuid(), asset.type(), asset.uid(), asset.displayName(), asset.payload());
    }
}
