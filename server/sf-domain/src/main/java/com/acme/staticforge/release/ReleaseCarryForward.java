package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.revision.RevisionAware;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Moves release pointers along with system migrations (M27.1.2, epic decision 13). A migration — the M24 localizable
 * toggle, a dataset's {@code renamedFrom} record migration, a set query rename — rewrites payloads nobody edited. For
 * each locale that was {@link ReleaseStatus#PUBLISHED} before the rewrite, the pointer moves to the migrated version
 * in the migration revision, so the asset stays published and the released state has the new shape.
 * A locale with unreleased changes keeps its pointer; readers of released payloads tolerate the old shape.
 *
 * <p>A separate component rather than a method of {@link ReleaseService}: the migrations are low-level writers that
 * {@link ReleaseService} itself depends on through the asset services, so this must not depend back on them.
 */
@Component
@RevisionAware
public class ReleaseCarryForward {

    private final AssetReleaseRepository releaseRepository;
    private final AssetVersionRepository versionRepository;
    private final ProjectLocales projectLocales;

    public ReleaseCarryForward(
            AssetReleaseRepository releaseRepository,
            AssetVersionRepository versionRepository,
            ProjectLocales projectLocales) {
        this.releaseRepository = releaseRepository;
        this.versionRepository = versionRepository;
        this.projectLocales = projectLocales;
    }

    /**
     * Carries the published pointers of rewritten assets to their new versions, all in {@code revisionId}. Must run
     * in the migration's transaction, after the new versions are saved.
     *
     * @return the number of pointers moved
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public int carryForward(long projectId, Collection<Rewrite> rewrites, long revisionId) {
        if (rewrites.isEmpty()) {
            return 0;
        }
        Map<Long, Rewrite> byAsset = rewrites.stream().collect(Collectors.toMap(Rewrite::assetId, Function.identity(), (a, b) -> b));
        List<AssetRelease> open = Chunks.flatMap(byAsset.keySet(), releaseRepository::findByAssetIdInAndValidToRevisionIsNull)
                .stream()
                .filter(p -> p.getValidFromRevision() < revisionId)
                .toList();
        if (open.isEmpty()) {
            return 0;
        }
        Set<Long> versionIds = new HashSet<>();
        open.forEach(p -> versionIds.add(p.getReleasedVersionId()));
        byAsset.values().forEach(r -> versionIds.add(r.previousVersionId()));
        Map<Long, AssetVersion> versions = Chunks.flatMap(versionIds, versionRepository::findAllById).stream()
                .collect(Collectors.toMap(AssetVersion::getId, Function.identity()));

        LocaleConfig config = projectLocales.forProject(projectId);
        List<AssetRelease> opened = new ArrayList<>();
        for (AssetRelease pointer : open) {
            Rewrite rewrite = byAsset.get(pointer.getAssetId());
            if (!wasPublished(pointer, rewrite, versions, config)) {
                continue;
            }
            pointer.setValidToRevision(revisionId);
            opened.add(new AssetRelease(
                    pointer.getProjectId(),
                    pointer.getAssetId(),
                    pointer.getLocaleKey(),
                    rewrite.newVersionId(),
                    pointer.getReleasedUid(),
                    revisionId,
                    pointer.getReleasedBy(),
                    pointer.getReleasedAt()));
        }
        releaseRepository.saveAll(open);
        releaseRepository.saveAll(opened);
        return opened.size();
    }

    private static boolean wasPublished(
            AssetRelease pointer, Rewrite rewrite, Map<Long, AssetVersion> versions, LocaleConfig config) {
        if (pointer.getReleasedVersionId().equals(rewrite.previousVersionId())) {
            return true;
        }
        AssetVersion previous = versions.get(rewrite.previousVersionId());
        AssetVersion released = versions.get(pointer.getReleasedVersionId());
        if (previous == null || released == null || previous.isDeleted()) {
            return false;
        }
        // The migration keeps the uid, so the draft's uid is the one before the rewrite.
        String uid = previous.getAsset() == null ? pointer.getReleasedUid() : previous.getAsset().getUid();
        return Objects.equals(
                LocaleProjection.project(previous, uid, pointer.getLocaleKey(), config),
                LocaleProjection.project(released, pointer.getReleasedUid(), pointer.getLocaleKey(), config));
    }

    /** One migrated asset: the version the migration closed and the one it wrote. */
    public record Rewrite(long assetId, long previousVersionId, long newVersionId) {}
}
