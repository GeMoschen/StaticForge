package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.content.ContentValidator;
import com.acme.staticforge.asset.content.PaginationSourceLookup;
import com.acme.staticforge.asset.content.TemplateContentDefinitions;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.content.RecordDatasetLookup;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The repository-backed {@link RecordDatasetLookup} of a project (M19.3.2): save paths validate a
 * {@code reference} editor's {@code dataset "uid"} restriction against the live records. Also the project's
 * {@link PaginationSourceLookup} (M21.1.1), so every content save checks a pagination value's source.
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

    /** The pagination source lookup for one project: live navigation folders and live datasets. */
    public PaginationSourceLookup paginationSources(long projectId) {
        return new PaginationSourceLookup() {
            @Override
            public boolean isNavigationFolder(UUID uuid) {
                return live(projectId, uuid, AssetType.FOLDER)
                        .map(payload -> FolderScope.fromPayload(payload) == FolderScope.NAVIGATION)
                        .orElse(false);
            }

            @Override
            public Optional<ContentDefinition> datasetSchema(UUID uuid) {
                return live(projectId, uuid, AssetType.DATASET).map(TemplateContentDefinitions::of);
            }
        };
    }

    /** The payload of the live, non-deleted asset {@code uuid} of {@code type}. */
    private Optional<com.fasterxml.jackson.databind.JsonNode> live(long projectId, UUID uuid, AssetType type) {
        return assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .filter(asset -> asset.getAssetType() == type)
                .flatMap(asset -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                .filter(version -> !version.isDeleted())
                .map(version -> version.getPayload());
    }

    /** A content validator that checks dataset restrictions and pagination sources against this project's assets. */
    public ContentValidator validator(long projectId) {
        return new ContentValidator(new ExpressionEvaluator(), forProject(projectId), paginationSources(projectId));
    }
}
