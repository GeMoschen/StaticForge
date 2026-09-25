package com.acme.staticforge.preview;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.content.AssetValueProjection;
import com.acme.staticforge.asset.content.TemplateContentDefinitions;
import com.acme.staticforge.asset.dataset.RecordValues;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.release.ContentView;
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
 * Preview's {@link AssetValueResolver}: cross-asset values as the preview's {@link ContentView} renders them — the
 * drafts (current, or valid at the time-travel revision) or the release state (M27.2.3) — projected through
 * {@link AssetValueProjection}, exactly like generation's snapshot resolver. Lookups are scoped to the view's project
 * (UUIDs are only unique per project).
 *
 * <p>One instance per page render (single thread): projections are memoized per UUID, so a value read inside a loop
 * hits the repository once.
 */
final class LiveAssetValueResolver implements AssetValueResolver {

    private final ContentView view;
    private final AssetRepository assetRepository;
    private final Map<UUID, JsonNode> projections = new HashMap<>();
    private final Map<UUID, DatasetRecords> datasets = new HashMap<>();
    private final Map<UUID, Optional<RecordSetSource>> recordSets = new HashMap<>();

    /** The reading's locale and its chain: a localized media file reads as the file that locale renders (M27.3.2). */
    private final String locale;
    private final List<String> mediaChain;

    LiveAssetValueResolver(ContentView view, AssetRepository assetRepository, String locale, List<String> mediaChain) {
        this.view = view;
        this.assetRepository = assetRepository;
        this.locale = locale;
        this.mediaChain = mediaChain;
    }

    /** The dataset's records present in the view (M19.3.2): soft-deleted and — published — unreleased ones left out. */
    @Override
    public List<RecordView> datasetRecords(UUID datasetUuid) {
        return records(datasetUuid).all();
    }

    /**
     * The record set as the view renders it (M25.2.2): its version (its stored query), the dataset's schema (the query
     * compiles against it), and the records that sit in the set in the view — read from the same per-dataset load as
     * {@link #datasetRecords}, grouped by set. A missing, soft-deleted or unreleased set is {@code null}.
     */
    @Override
    public RecordSetSource recordSet(UUID setUuid) {
        return recordSets.computeIfAbsent(setUuid, this::loadSet).orElse(null);
    }

    private Optional<RecordSetSource> loadSet(UUID setUuid) {
        ContentView.Resolved set = view.resolve(setUuid)
                .filter(found -> found.asset().getAssetType() == AssetType.RECORD_SET)
                .orElse(null);
        if (set == null) {
            return Optional.empty();
        }
        JsonNode payload = set.version().getPayload();
        UUID datasetUuid = RecordValues.datasetRef(payload);
        ContentView.Resolved dataset = datasetUuid == null ? null : view.resolve(datasetUuid).orElse(null);
        ContentDefinition definition = dataset == null ? null : TemplateContentDefinitions.of(dataset.version().getPayload());
        List<RecordView> members = datasetUuid == null
                ? List.of()
                : records(datasetUuid).bySet().getOrDefault(set.asset().getId(), List.of());
        return Optional.of(new RecordSetSource(
                setUuid,
                set.uid(),
                set.version().getDisplayName(),
                datasetUuid,
                dataset == null ? null : dataset.uid(),
                RecordSetQueries.compile(RecordSetQuery.fromJson(payload.path("query")), definition),
                definition,
                members));
    }

    private DatasetRecords records(UUID datasetUuid) {
        return datasets.computeIfAbsent(datasetUuid, this::loadRecords);
    }

    private DatasetRecords loadRecords(UUID datasetUuid) {
        Optional<Asset> dataset = assetRepository.findByProjectIdAndUuid(view.projectId(), datasetUuid)
                .filter(asset -> asset.getAssetType() == AssetType.DATASET);
        if (dataset.isEmpty()) {
            return DatasetRecords.EMPTY;
        }
        List<ContentView.Resolved> found = view.recordsOfDataset(dataset.get().getId());
        List<AssetVersion> versions = found.stream().map(ContentView.Resolved::version).toList();
        Map<Long, String> setUids = RecordValues.recordSetUids(assetRepository, versions);
        List<RecordView> records = new ArrayList<>(found.size());
        Map<Long, List<RecordView>> bySet = new HashMap<>();
        for (ContentView.Resolved record : found) {
            AssetVersion version = record.version();
            RecordView item = RecordValues.view(
                    record.asset().getUuid(), record.uid(), version.getDisplayName(), version.getFolderPath(),
                    setUids.get(version.getFolderId()), version.getChangedAt(), version.getPayload());
            records.add(item);
            if (version.getFolderId() != null) {
                bySet.computeIfAbsent(version.getFolderId(), set -> new ArrayList<>()).add(item);
            }
        }
        return new DatasetRecords(records, bySet);
    }

    /** A dataset's records in the view, and the same records by the asset id of the set holding them. */
    private record DatasetRecords(List<RecordView> all, Map<Long, List<RecordView>> bySet) {
        static final DatasetRecords EMPTY = new DatasetRecords(List.of(), Map.of());
    }

    @Override
    public JsonNode valueOf(String assetType, UUID uuid) {
        return projections.computeIfAbsent(uuid, u -> project(assetType, u));
    }

    private JsonNode project(String assetType, UUID uuid) {
        AssetType expected = AssetReferencePrefixes.assetTypeForRef(assetType);
        if (expected == null) {
            return MissingNode.getInstance();
        }
        return view.resolve(uuid)
                .filter(found -> found.asset().getAssetType() == expected)
                .map(found -> expected == AssetType.RECORD
                        ? recordItem(found)
                        : AssetValueProjection.project(
                                expected,
                                found.uid(),
                                found.version().getDisplayName(),
                                expected == AssetType.MEDIA
                                        ? MediaFiles.effective(found.version().getPayload(), locale, mediaChain)
                                        : found.version().getPayload(),
                                false))
                .orElse(MissingNode.getInstance());
    }

    /** A record reads as its loop item, so {@code record:x.name} and a loop's {@code member.name} agree. */
    private JsonNode recordItem(ContentView.Resolved record) {
        AssetVersion version = record.version();
        String setUid = version.getFolderId() == null
                ? null
                : assetRepository.findById(version.getFolderId()).map(Asset::getUid).orElse(null);
        return RecordValues.view(
                        record.asset().getUuid(), record.uid(), version.getDisplayName(), version.getFolderPath(), setUid,
                        version.getChangedAt(), version.getPayload())
                .item();
    }
}
