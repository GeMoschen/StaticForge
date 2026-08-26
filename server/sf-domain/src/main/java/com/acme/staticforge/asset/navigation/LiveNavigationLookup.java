package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * {@link NavigationLookup} over the live repositories (spec §17, `M8.1.3`) — backs preview's
 * read path, mirroring how {@code PageRenderService} reads live assets (as opposed to
 * generation's revision-pinned {@code Snapshot} path, {@code SnapshotNavigationLookup} in
 * sf-generate). Stateless; takes an explicit {@code projectId} like every other project-scoped
 * lookup in this codebase, so asset uuid resolution is scoped to the caller's project.
 */
@Component
public class LiveNavigationLookup implements NavigationLookup {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;

    public LiveNavigationLookup(AssetRepository assetRepository, AssetVersionRepository assetVersionRepository) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
    }

    @Override
    public Optional<NavigationAsset> byUuid(long projectId, UUID uuid) {
        if (uuid == null) {
            return Optional.empty();
        }
        return assetRepository.findByProjectIdAndUuid(projectId, uuid).flatMap(asset -> assetVersionRepository
                .findByAssetIdAndValidToRevisionIsNull(asset.getId())
                .filter(v -> !v.isDeleted())
                .map(v -> toNavigationAsset(asset, v)));
    }

    @Override
    public List<NavigationAsset> childrenOf(long projectId, UUID folderUuid) {
        if (folderUuid == null) {
            return List.of();
        }
        return assetRepository.findByProjectIdAndUuid(projectId, folderUuid)
                .map(folder -> assetVersionRepository
                        .findByFolderIdAndValidToRevisionIsNullAndDeletedFalse(folder.getId())
                        .stream()
                        .map(v -> assetRepository.findById(v.getAssetId()).map(a -> toNavigationAsset(a, v)))
                        .flatMap(Optional::stream)
                        .toList())
                .orElseGet(List::of);
    }

    private static NavigationAsset toNavigationAsset(Asset asset, AssetVersion version) {
        return new NavigationAsset(asset.getUuid(), asset.getAssetType(), asset.getUid(), version.getDisplayName(), version.getPayload());
    }
}
