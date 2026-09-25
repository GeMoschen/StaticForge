package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Loads {@link ReleaseState}s (M27.1.1): one query for a whole project, as a build snapshot needs it. */
@Service
public class ReleaseStates {

    private final AssetReleaseRepository releases;
    private final AssetVersionRepository versions;

    public ReleaseStates(AssetReleaseRepository releases, AssetVersionRepository versions) {
        this.releases = releases;
        this.versions = versions;
    }

    /** The release state of a project at revision {@code revision}. */
    @Transactional(readOnly = true)
    public ReleaseState at(long projectId, long revision) {
        return new ReleaseState(projectId, revision, releases.findValidAtByProject(projectId, revision));
    }

    /** The release state of some assets at revision {@code revision}; other assets read as unreleased. */
    @Transactional(readOnly = true)
    public ReleaseState at(long projectId, long revision, Collection<Long> assetIds) {
        List<AssetRelease> pointers =
                assetIds.isEmpty() ? List.of() : Chunks.flatMap(assetIds, ids -> releases.findValidAtByAssetIdIn(ids, revision));
        return new ReleaseState(projectId, revision, pointers);
    }

    /**
     * The versions {@code state}'s pointers name, by version id, except those in {@code loaded} (the caller already
     * holds them — usually the versions valid at the same revision, which most pointers name). One query per 1,000
     * ids; a version several locales share is loaded once. The versions' assets are not fetched.
     */
    @Transactional(readOnly = true)
    public Map<Long, AssetVersion> releasedVersions(ReleaseState state, Set<Long> loaded) {
        Set<Long> ids = new HashSet<>();
        for (Long assetId : state.releasedAssetIds()) {
            state.pointers(assetId).values().forEach(pointer -> ids.add(pointer.getReleasedVersionId()));
        }
        ids.removeAll(loaded);
        Map<Long, AssetVersion> byId = new HashMap<>();
        if (!ids.isEmpty()) {
            Chunks.flatMap(ids, versions::findAllById).forEach(version -> byId.put(version.getId(), version));
        }
        return byId;
    }
}
