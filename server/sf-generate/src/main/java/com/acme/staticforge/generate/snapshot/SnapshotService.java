package com.acme.staticforge.generate.snapshot;

import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Materializes a revision-pinned {@link Snapshot} of a project's assets for generation
 * (spec §18.2). The asset rows are JOIN-fetched by the repository queries, so no lazy
 * access occurs during mapping.
 */
@Service
public class SnapshotService {

    private final AssetVersionRepository versions;

    public SnapshotService(AssetVersionRepository versions) {
        this.versions = versions;
    }

    public Snapshot snapshot(long projectId, Long revision) {
        List<AssetVersion> loaded;
        long pinnedRevision;
        if (revision == null) {
            loaded = versions.findCurrentSnapshot(projectId);
            pinnedRevision = loaded.stream()
                    .mapToLong(AssetVersion::getValidFromRevision)
                    .max()
                    .orElse(0L);
        } else {
            pinnedRevision = revision;
            loaded = versions.findSnapshot(projectId, revision);
        }

        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        Map<Long, SnapshotAsset> byAssetId = new HashMap<>();
        for (AssetVersion v : loaded) {
            var asset = v.getAsset();
            SnapshotAsset sa = new SnapshotAsset(
                    asset.getUuid(),
                    v.getAssetId(),
                    asset.getAssetType(),
                    asset.getUid(),
                    v.getDisplayName(),
                    v.getFolderPath(),
                    v.getPayload(),
                    v.isDeleted());
            byAssetId.put(sa.assetId(), sa);
            if (sa.uuid() != null) {
                byUuid.put(sa.uuid(), sa);
            }
        }

        return new Snapshot(projectId, pinnedRevision, Map.copyOf(byUuid), Map.copyOf(byAssetId));
    }
}
