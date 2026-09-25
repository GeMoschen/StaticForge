package com.acme.staticforge.release;

import java.util.Collection;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Loads {@link ReleaseState}s (M27.1.1): one query for a whole project, as a build snapshot needs it. */
@Service
public class ReleaseStates {

    private final AssetReleaseRepository releases;

    public ReleaseStates(AssetReleaseRepository releases) {
        this.releases = releases;
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
}
