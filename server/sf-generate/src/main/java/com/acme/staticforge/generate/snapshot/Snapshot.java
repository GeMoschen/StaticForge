package com.acme.staticforge.generate.snapshot;

import com.acme.staticforge.asset.AssetType;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * An immutable, revision-pinned set of assets for a generation run (spec §18.2). Assets are
 * indexed by {@code uuid} and by numeric asset id for O(1) lookup during rendering.
 */
public record Snapshot(long projectId, long revision, Map<UUID, SnapshotAsset> byUuid, Map<Long, SnapshotAsset> byAssetId) {

    public SnapshotAsset assetByUuid(UUID uuid) {
        return byUuid.get(uuid);
    }

    public SnapshotAsset assetById(long assetId) {
        return byAssetId.get(assetId);
    }

    public List<SnapshotAsset> assetsOfType(AssetType type) {
        return byUuid.values().stream()
                .filter(a -> a.type() == type)
                .filter(a -> !a.deleted())
                .toList();
    }

    public List<SnapshotAsset> pages() {
        return assetsOfType(AssetType.PAGE);
    }
}
