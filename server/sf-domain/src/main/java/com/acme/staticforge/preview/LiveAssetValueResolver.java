package com.acme.staticforge.preview;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.content.AssetValueProjection;
import com.acme.staticforge.asset.dataset.RecordValues;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.template.query.RecordView;
import com.acme.staticforge.template.render.AssetValueResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Preview's {@link AssetValueResolver}: cross-asset values from the version valid at the preview
 * revision — the current version for a live preview, the version at {@code revision} for time
 * travel — projected through {@link AssetValueProjection}, exactly like generation's snapshot
 * resolver. Lookups are scoped to one project (UUIDs are only unique per project).
 *
 * <p>One instance per page render (single thread): projections are memoized per UUID, so a value
 * read inside a loop hits the repository once.
 */
final class LiveAssetValueResolver implements AssetValueResolver {

    private final AssetService assetService;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final long projectId;
    private final Long revision;
    private final Map<UUID, JsonNode> projections = new HashMap<>();
    private final Map<UUID, List<RecordView>> datasets = new HashMap<>();

    /** @param revision the time-travel revision, or {@code null} for the current state */
    LiveAssetValueResolver(
            AssetService assetService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            long projectId,
            Long revision) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.projectId = projectId;
        this.revision = revision;
    }

    /**
     * The dataset's records live at the preview revision (M19.3.2): the current ones, or for time
     * travel the ones valid at {@code revision} — soft-deleted records never included.
     */
    @Override
    public List<RecordView> datasetRecords(UUID datasetUuid) {
        return datasets.computeIfAbsent(datasetUuid, this::loadRecords);
    }

    private List<RecordView> loadRecords(UUID datasetUuid) {
        Optional<Asset> dataset = assetRepository.findByProjectIdAndUuid(projectId, datasetUuid)
                .filter(asset -> asset.getAssetType() == AssetType.DATASET);
        if (dataset.isEmpty()) {
            return List.of();
        }
        long datasetId = dataset.get().getId();
        List<AssetVersion> versions = revision == null
                ? assetVersionRepository.findCurrentRecordsOfDataset(projectId, datasetId)
                : assetVersionRepository.findRecordsOfDatasetAt(projectId, datasetId, revision);
        List<RecordView> records = new ArrayList<>(versions.size());
        for (AssetVersion version : versions) {
            records.add(RecordValues.view(
                    version.getAsset().getUuid(), version.getAsset().getUid(), version.getDisplayName(),
                    version.getFolderPath(), version.getChangedAt(), version.getPayload()));
        }
        return records;
    }

    @Override
    public JsonNode valueOf(String assetType, UUID uuid) {
        return projections.computeIfAbsent(uuid, u -> project(assetType, u));
    }

    private JsonNode project(String assetType, UUID uuid) {
        AssetType expected = AssetReferencePrefixes.assetTypeForRef(assetType);
        if (expected == null || assetRepository.findByProjectIdAndUuid(projectId, uuid).isEmpty()) {
            return MissingNode.getInstance();
        }
        Optional<AssetVersionView> version = revision == null
                ? Optional.of(assetService.requireCurrent(projectId, uuid))
                : assetService.findAt(projectId, uuid, revision);
        return version
                .filter(v -> v.type() == expected)
                .map(v -> v.type() == AssetType.RECORD
                        ? recordItem(v)
                        : AssetValueProjection.project(v.type(), v.uid(), v.displayName(), v.payload(), v.deleted()))
                .orElse(MissingNode.getInstance());
    }

    /** A record reads as its loop item, so {@code record:x.name} and a loop's {@code member.name} agree. */
    private static JsonNode recordItem(AssetVersionView version) {
        if (version.deleted()) {
            return MissingNode.getInstance();
        }
        return RecordValues.view(
                        version.uuid(), version.uid(), version.displayName(), version.folderPath(),
                        version.changedAt(), version.payload())
                .item();
    }
}
