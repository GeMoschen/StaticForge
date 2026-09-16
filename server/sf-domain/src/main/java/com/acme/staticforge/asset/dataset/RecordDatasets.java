package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.content.ContentValidator;
import com.acme.staticforge.asset.content.RecordDatasetLookup;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import org.springframework.stereotype.Component;

/**
 * The repository-backed {@link RecordDatasetLookup} of a project (M19.3.2): save paths validate a
 * {@code reference} editor's {@code dataset "uid"} restriction against the live records.
 */
@Component
public class RecordDatasets {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;

    public RecordDatasets(AssetRepository assetRepository, AssetVersionRepository assetVersionRepository) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
    }

    /** The lookup for one project: live records only, a deleted record belongs to no dataset. */
    public RecordDatasetLookup forProject(long projectId) {
        return recordUuid -> assetRepository.findByProjectIdAndUuid(projectId, recordUuid)
                .filter(asset -> asset.getAssetType() == AssetType.RECORD)
                .flatMap(asset -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                .filter(version -> !version.isDeleted())
                .map(version -> RecordValues.datasetRef(version.getPayload()))
                .flatMap(datasetUuid -> assetRepository.findByProjectIdAndUuid(projectId, datasetUuid))
                .map(Asset::getUid);
    }

    /** A content validator that checks dataset restrictions against this project's records. */
    public ContentValidator validator(long projectId) {
        return new ContentValidator(new ExpressionEvaluator(), forProject(projectId));
    }
}
