package com.acme.staticforge.revision;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Project-wide rollback (spec §7.6): restores every asset to its state at
 * {@code toRevision}, implemented as a single bulk revision. History is append-only.
 *
 * <p>Takes raw {@code (projectId, userId, comment)} rather than a {@link RevisionContext}:
 * unlike {@code ProjectServiceImpl.create}, {@code restoreTo} has no nested {@code @RevisionAware}
 * service calls to join its batch through — it writes {@link AssetVersion} rows directly — so a
 * full context would carry an {@code openRevision} nothing downstream ever reads.
 */
@Service
@RevisionAware
public class ProjectRestoreService {

    private final RevisionService revisionService;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetRepository assetRepository;
    private final ObjectMapper objectMapper;

    public ProjectRestoreService(
            RevisionService revisionService,
            AssetVersionRepository assetVersionRepository,
            AssetRepository assetRepository,
            ObjectMapper objectMapper) {
        this.revisionService = revisionService;
        this.assetVersionRepository = assetVersionRepository;
        this.assetRepository = assetRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public Revision restoreTo(long projectId, long toRevision, Long userId, String comment) {
        Revision bulk = revisionService.allocate(projectId, ChangeType.RESTORE, comment, userId);
        long newRevision = bulk.getRevisionId();

        Map<Long, AssetVersion> current = new HashMap<>();
        for (AssetVersion v : assetVersionRepository.findCurrentByProject(projectId)) {
            current.put(v.getAssetId(), v);
        }
        Map<Long, AssetVersion> target = new HashMap<>();
        for (AssetVersion v : assetVersionRepository.findValidAtRevisionByProject(projectId, toRevision)) {
            target.put(v.getAssetId(), v);
        }

        java.util.Set<Long> all = new java.util.HashSet<>();
        all.addAll(current.keySet());
        all.addAll(target.keySet());

        // One prefetch of every touched asset's identity (uuid/type/uid), rather than a lookup
        // per iteration, so the summary entries below don't turn this single pass into two.
        Map<Long, Asset> assets = new HashMap<>();
        for (Asset asset : assetRepository.findAllById(all)) {
            assets.put(asset.getId(), asset);
        }

        Instant now = Instant.now();
        for (Long assetId : all) {
            AssetVersion cur = current.get(assetId);
            if (cur != null) {
                cur.setValidToRevision(newRevision);
                assetVersionRepository.save(cur);
            }

            AssetVersion tgt = target.get(assetId);
            String action;
            if (tgt != null && !tgt.isDeleted()) {
                AssetVersion restored = new AssetVersion(
                        assetId, newRevision, tgt.getDisplayName(), tgt.getPayload(), userId, now);
                restored.setFolderId(tgt.getFolderId());
                restored.setFolderPath(tgt.getFolderPath());
                restored.setTemplateAssetId(tgt.getTemplateAssetId());
                restored.setMimeType(tgt.getMimeType());
                restored.setSizeBytes(tgt.getSizeBytes());
                assetVersionRepository.save(restored);
                action = "RESTORE";
            } else {
                // payload is NOT NULL on asset_version — a deleted tombstone still carries the
                // last known payload (mirrors AssetServiceImpl.softDelete), sourced from
                // whichever of current/target actually has a version row for this asset.
                AssetVersion source = cur != null ? cur : tgt;
                AssetVersion deleted = new AssetVersion(
                        assetId, newRevision, source != null ? source.getDisplayName() : "",
                        source != null ? source.getPayload() : objectMapper.createObjectNode(), userId, now);
                deleted.setDeleted(true);
                assetVersionRepository.save(deleted);
                action = "DELETE";
            }

            Asset asset = assets.get(assetId);
            if (asset != null) {
                revisionService.appendSummary(
                        projectId,
                        newRevision,
                        new AssetChange(
                                asset.getUuid().toString(), asset.getAssetType().name(), asset.getUid(), action, null, false));
            }
        }
        return bulk;
    }
}
