package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.content.ContentRenameMigrator.EditorRename;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.query.RecordSetQueries;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a dataset schema change does to the stored queries of the dataset's record sets (M25.1.2, §12.3):
 * {@code renamedFrom} hops rewrite the field names inside every current set's {@code where}/{@code sort} in
 * the schema change's own revision, and a field that is gone or retyped leaves the sets reading it
 * {@linkplain #brokenSets broken} — reported, never silently widened to "every record".
 */
@Component
public class RecordSetQueryMigration {

    private final AssetService assetService;
    private final AssetVersionRepository assetVersionRepository;

    public RecordSetQueryMigration(AssetService assetService, AssetVersionRepository assetVersionRepository) {
        this.assetService = assetService;
        this.assetVersionRepository = assetVersionRepository;
    }

    /**
     * Applies {@code renames} to the query of every current set of the dataset whose query names a renamed
     * field, writing each changed set in {@code batchCtx}'s open revision (through {@link AssetService}, so
     * summaries and reference rows are the generic ones). The rewrite works on the parsed query
     * ({@link RecordSetQueries#rename}), so a string literal spelling a field name is left alone.
     *
     * <p>Must run inside the transaction that opened {@code batchCtx}'s revision, before anything that
     * clears the persistence context.
     *
     * @return how many sets were rewritten
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public int migrate(long projectId, long datasetAssetId, List<EditorRename> renames, RevisionContext batchCtx) {
        if (renames.isEmpty()) {
            return 0;
        }
        Map<String, String> byPreviousName = new LinkedHashMap<>();
        renames.forEach(rename -> byPreviousName.put(rename.from(), rename.to()));
        int rewritten = 0;
        for (AssetVersion set : assetVersionRepository.findCurrentSetsOfDataset(projectId, datasetAssetId)) {
            RecordSetQuery query = RecordSetQuery.fromJson(set.getPayload().get("query"));
            RecordSetQuery renamed = RecordSetQueries.rename(query, byPreviousName);
            if (renamed.equals(query)) {
                continue;
            }
            ObjectNode payload = set.getPayload().deepCopy();
            payload.set("query", renamed.toJson());
            assetService.update(
                    set.getAsset().getUuid(),
                    new UpdateAssetCommand(set.getDisplayName(), payload),
                    set.getValidFromRevision(),
                    batchCtx);
            rewritten++;
        }
        return rewritten;
    }

    /**
     * The dataset's current sets whose stored query does not validate against {@code definition}, by
     * display name — the warning a dataset save returns after removing or retyping a field a set reads. Runs
     * in the caller's transaction, after its schema write.
     */
    public List<BrokenRecordSet> brokenSets(long projectId, long datasetAssetId, ContentDefinition definition) {
        List<BrokenRecordSet> broken = new ArrayList<>();
        for (AssetVersion set : assetVersionRepository.findCurrentSetsOfDataset(projectId, datasetAssetId)) {
            RecordSetQueries.Compiled compiled =
                    RecordSetQueries.compile(RecordSetQuery.fromJson(set.getPayload().get("query")), definition);
            if (!compiled.valid()) {
                broken.add(new BrokenRecordSet(
                        set.getAsset().getUuid(), set.getAsset().getUid(), set.getDisplayName(), compiled.diagnostics()));
            }
        }
        broken.sort(Comparator.comparing(BrokenRecordSet::displayName, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(BrokenRecordSet::uid));
        return broken;
    }
}
