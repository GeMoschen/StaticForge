package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.content.ContentRenameMigrator.EditorRename;
import com.acme.staticforge.asset.content.ContentRenameMigrator;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Rewrites the content keys of every current record of a dataset after a {@code renamedFrom} schema
 * change (M19.1.2, §12.3), inside the caller's already open batch revision.
 *
 * <p>A dataset can have thousands of records, all rewritten in one transaction and one revision.
 * Going through {@code AssetService.update} per record makes that quadratic twice over: every
 * update re-serializes the growing revision summary, and every query dirty-checks every version
 * loaded so far (measured: 1,000 records took 21 s). So this writes the versions directly, in chunks
 * whose persistence context is flushed and cleared, and appends all summary entries in one write.
 * Each version write still materializes its reference rows in the same revision, like every other
 * version write (§5.4).
 */
@Component
@RevisionAware
public class RecordRenameMigration {

    /** Records per flushed and cleared chunk. */
    static final int CHUNK_SIZE = 200;

    private final AssetVersionRepository assetVersionRepository;
    private final ReferenceMaterializer referenceMaterializer;
    private final RevisionService revisionService;

    @PersistenceContext
    private EntityManager entityManager;

    public RecordRenameMigration(
            AssetVersionRepository assetVersionRepository,
            ReferenceMaterializer referenceMaterializer,
            RevisionService revisionService) {
        this.assetVersionRepository = assetVersionRepository;
        this.referenceMaterializer = referenceMaterializer;
        this.revisionService = revisionService;
    }

    /**
     * Applies {@code renames} to every current record of the dataset that holds a renamed value and
     * records one {@code UPDATE} summary entry per rewritten record.
     *
     * <p>Must run inside the transaction that opened {@code batchCtx}'s revision — which holds the
     * project's revision counter lock, so no record edit can interleave — and after every other write
     * of that transaction the caller still needs managed: the persistence context is cleared.
     *
     * @return how many records were rewritten
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public int migrate(long projectId, long datasetAssetId, List<EditorRename> renames, RevisionContext batchCtx) {
        if (renames.isEmpty()) {
            return 0;
        }
        long revisionId = batchCtx.openRevision().getRevisionId();
        entityManager.flush();
        List<Long> versionIds = assetVersionRepository.findCurrentRecordVersionIdsOfDataset(projectId, datasetAssetId);
        List<AssetChange> changes = new ArrayList<>();
        Instant now = Instant.now();
        for (int from = 0; from < versionIds.size(); from += CHUNK_SIZE) {
            List<Long> chunk = versionIds.subList(from, Math.min(from + CHUNK_SIZE, versionIds.size()));
            for (AssetVersion current : assetVersionRepository.findWithAssetByIdIn(chunk)) {
                ObjectNode payload = current.getPayload().deepCopy();
                JsonNode content = payload.get("content");
                if (current.getValidToRevision() != null
                        || !(content instanceof ObjectNode values)
                        || !ContentRenameMigrator.apply(values, renames)) {
                    continue;
                }
                Asset asset = current.getAsset();
                current.setValidToRevision(revisionId);
                assetVersionRepository.save(current);

                AssetVersion next = new AssetVersion(
                        current.getAssetId(), revisionId, current.getDisplayName(), payload, batchCtx.userId(), now);
                next.setFolderId(current.getFolderId());
                next.setFolderPath(current.getFolderPath());
                next.setTemplateAssetId(current.getTemplateAssetId());
                next.setDeleted(false);
                next.setAsset(asset);
                referenceMaterializer.materialize(asset, assetVersionRepository.save(next));
                changes.add(AssetChange.create(asset.getUuid().toString(), AssetType.RECORD.name(), "UPDATE", List.of("payload")));
            }
            entityManager.flush();
            entityManager.clear();
        }
        revisionService.appendSummaries(projectId, revisionId, changes);
        return changes.size();
    }
}
