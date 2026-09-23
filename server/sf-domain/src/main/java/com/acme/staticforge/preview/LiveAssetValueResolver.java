package com.acme.staticforge.preview;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.content.AssetValueProjection;
import com.acme.staticforge.asset.content.TemplateContentDefinitions;
import com.acme.staticforge.asset.dataset.RecordValues;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.query.RecordSetQueries;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.template.query.RecordView;
import com.acme.staticforge.template.render.AssetValueResolver;
import com.acme.staticforge.template.render.RecordSetSource;
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
    private final Map<UUID, DatasetRecords> datasets = new HashMap<>();
    private final Map<UUID, Optional<RecordSetSource>> recordSets = new HashMap<>();

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
        return records(datasetUuid).all();
    }

    /**
     * The record set as of the preview revision (M25.2.2): the set version valid then (its stored query), the
     * dataset's schema valid then (the query compiles against it), and the records that sat in the set then — read
     * from the same per-dataset load as {@link #datasetRecords}, grouped by set. A missing or soft-deleted set is
     * {@code null}.
     */
    @Override
    public RecordSetSource recordSet(UUID setUuid) {
        return recordSets.computeIfAbsent(setUuid, this::loadSet).orElse(null);
    }

    private Optional<RecordSetSource> loadSet(UUID setUuid) {
        Optional<Asset> asset = assetRepository.findByProjectIdAndUuid(projectId, setUuid)
                .filter(found -> found.getAssetType() == AssetType.RECORD_SET);
        AssetVersionView set = asset.flatMap(found -> versionAt(setUuid)).filter(version -> !version.deleted()).orElse(null);
        if (set == null) {
            return Optional.empty();
        }
        UUID datasetUuid = RecordValues.datasetRef(set.payload());
        AssetVersionView dataset = datasetUuid == null ? null : versionAt(datasetUuid).orElse(null);
        ContentDefinition definition = dataset == null ? null : TemplateContentDefinitions.of(dataset.payload());
        List<RecordView> members = datasetUuid == null
                ? List.of()
                : records(datasetUuid).bySet().getOrDefault(asset.get().getId(), List.of());
        return Optional.of(new RecordSetSource(
                setUuid,
                set.uid(),
                set.displayName(),
                datasetUuid,
                dataset == null ? null : dataset.uid(),
                RecordSetQueries.compile(RecordSetQuery.fromJson(set.payload().path("query")), definition),
                definition,
                members));
    }

    /** The version of {@code uuid} valid at the preview revision; empty when it doesn't exist (then). */
    private Optional<AssetVersionView> versionAt(UUID uuid) {
        if (assetRepository.findByProjectIdAndUuid(projectId, uuid).isEmpty()) {
            return Optional.empty();
        }
        return revision == null
                ? Optional.of(assetService.requireCurrent(projectId, uuid))
                : assetService.findAt(projectId, uuid, revision);
    }

    private DatasetRecords records(UUID datasetUuid) {
        return datasets.computeIfAbsent(datasetUuid, this::loadRecords);
    }

    private DatasetRecords loadRecords(UUID datasetUuid) {
        Optional<Asset> dataset = assetRepository.findByProjectIdAndUuid(projectId, datasetUuid)
                .filter(asset -> asset.getAssetType() == AssetType.DATASET);
        if (dataset.isEmpty()) {
            return DatasetRecords.EMPTY;
        }
        long datasetId = dataset.get().getId();
        List<AssetVersion> versions = revision == null
                ? assetVersionRepository.findCurrentRecordsOfDataset(projectId, datasetId)
                : assetVersionRepository.findRecordsOfDatasetAt(projectId, datasetId, revision);
        List<RecordView> records = new ArrayList<>(versions.size());
        Map<Long, List<RecordView>> bySet = new HashMap<>();
        Map<Long, String> setUids = RecordValues.recordSetUids(assetRepository, versions);
        for (AssetVersion version : versions) {
            RecordView view = RecordValues.view(
                    version.getAsset().getUuid(), version.getAsset().getUid(), version.getDisplayName(),
                    version.getFolderPath(), setUids.get(version.getFolderId()), version.getChangedAt(),
                    version.getPayload());
            records.add(view);
            if (version.getFolderId() != null) {
                bySet.computeIfAbsent(version.getFolderId(), set -> new ArrayList<>()).add(view);
            }
        }
        return new DatasetRecords(records, bySet);
    }

    /** A dataset's records at the preview revision, and the same records by the asset id of the set holding them. */
    private record DatasetRecords(List<RecordView> all, Map<Long, List<RecordView>> bySet) {
        static final DatasetRecords EMPTY = new DatasetRecords(List.of(), Map.of());
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
    private JsonNode recordItem(AssetVersionView version) {
        if (version.deleted()) {
            return MissingNode.getInstance();
        }
        String setUid = version.folderId() == null
                ? null
                : assetRepository.findById(version.folderId()).map(Asset::getUid).orElse(null);
        return RecordValues.view(
                        version.uuid(), version.uid(), version.displayName(), version.folderPath(), setUid,
                        version.changedAt(), version.payload())
                .item();
    }
}
