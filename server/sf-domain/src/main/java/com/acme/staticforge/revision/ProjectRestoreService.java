package com.acme.staticforge.revision;

import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Project-wide rollback (spec §7.6): restores every asset to its state at
 * {@code toRevision}, implemented as a single bulk revision. History is append-only.
 */
@Service
@RevisionAware
public class ProjectRestoreService {

    private final RevisionService revisionService;
    private final AssetVersionRepository assetVersionRepository;

    public ProjectRestoreService(RevisionService revisionService, AssetVersionRepository assetVersionRepository) {
        this.revisionService = revisionService;
        this.assetVersionRepository = assetVersionRepository;
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

        Instant now = Instant.now();
        for (Long assetId : all) {
            AssetVersion cur = current.get(assetId);
            if (cur != null) {
                cur.setValidToRevision(newRevision);
                assetVersionRepository.save(cur);
            }

            AssetVersion tgt = target.get(assetId);
            if (tgt != null && !tgt.isDeleted()) {
                AssetVersion restored = new AssetVersion(
                        assetId, newRevision, tgt.getDisplayName(), tgt.getPayload(), userId, now);
                restored.setFolderId(tgt.getFolderId());
                restored.setFolderPath(tgt.getFolderPath());
                restored.setTemplateAssetId(tgt.getTemplateAssetId());
                restored.setMimeType(tgt.getMimeType());
                restored.setSizeBytes(tgt.getSizeBytes());
                assetVersionRepository.save(restored);
            } else {
                AssetVersion deleted = new AssetVersion(
                        assetId, newRevision, cur != null ? cur.getDisplayName() : "", null, userId, now);
                deleted.setDeleted(true);
                assetVersionRepository.save(deleted);
            }
        }
        return bulk;
    }
}
