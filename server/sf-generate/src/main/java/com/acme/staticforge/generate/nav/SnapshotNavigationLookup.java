package com.acme.staticforge.generate.nav;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.navigation.NavigationAsset;
import com.acme.staticforge.asset.navigation.NavigationLookup;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

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
 */
public final class SnapshotNavigationLookup implements NavigationLookup {

    private final Snapshot snapshot;

    public SnapshotNavigationLookup(Snapshot snapshot) {
        this.snapshot = snapshot;
    }

    @Override
    public Optional<NavigationAsset> byUuid(long projectId, UUID uuid) {
        // projectId is unused: interface conformance only — a Snapshot is already project-scoped by construction.
        if (uuid == null) {
            return Optional.empty();
        }
        SnapshotAsset asset = snapshot.assetByUuid(uuid);
        if (asset == null || asset.deleted()) {
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
        if (folder == null || folder.deleted() || folder.type() != AssetType.FOLDER) {
            return List.of();
        }
        String parentPath = ensureTrailingSlash(folder.folderPath());

        return snapshot.byUuid().values().stream()
                .filter(a -> !a.deleted())
                .filter(a -> !a.uuid().equals(folderUuid))
                .filter(a -> isDirectChild(a, parentPath))
                .map(SnapshotNavigationLookup::toNavigationAsset)
                .toList();
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
