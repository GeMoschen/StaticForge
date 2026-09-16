package com.acme.staticforge.generate.snapshot;

import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.revision.RevisionRepository;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Materializes a revision-pinned {@link Snapshot} of a project's assets for generation
 * (spec §18.2). The asset rows are JOIN-fetched by the repository queries, so no lazy
 * access occurs during mapping.
 *
 * <p>A run without a revision is pinned to the project's head revision and loads exactly what a run
 * pinned to that revision loads: every version valid there, <em>soft-deleted versions included</em>.
 * Consumers skip deleted assets where they publish ({@link Snapshot#pages()}, the planner, asset copy,
 * navigation), while references to a deleted target still resolve and degrade to an empty render
 * with a warning (spec §16.4) instead of failing VALIDATE as an unknown UID.
 */
@Service
public class SnapshotService {

    private final AssetVersionRepository versions;
    private final RevisionRepository revisions;

    public SnapshotService(AssetVersionRepository versions, RevisionRepository revisions) {
        this.versions = versions;
        this.revisions = revisions;
    }

    public Snapshot snapshot(long projectId, Long revision) {
        long pinnedRevision = revision != null ? revision : revisions.findHeadRevisionId(projectId).orElse(0L);
        List<AssetVersion> loaded = versions.findSnapshot(projectId, pinnedRevision);

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
                    v.isDeleted(),
                    v.getChangedAt());
            byAssetId.put(sa.assetId(), sa);
            if (sa.uuid() != null) {
                byUuid.put(sa.uuid(), sa);
            }
        }

        return new Snapshot(projectId, pinnedRevision, Map.copyOf(byUuid), Map.copyOf(byAssetId));
    }
}
