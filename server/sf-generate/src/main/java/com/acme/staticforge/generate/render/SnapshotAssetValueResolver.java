package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.content.AssetValueProjection;
import com.acme.staticforge.asset.dataset.RecordValues;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.template.query.RecordView;
import com.acme.staticforge.template.render.AssetValueResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Generation's {@link AssetValueResolver}: cross-asset values read from the revision-pinned
 * {@link Snapshot} (so every page of a build sees the same state), projected through {@link
 * AssetValueProjection} exactly like preview. The snapshot is per project, so lookups can never
 * reach another project's asset.
 *
 * <p>Shared by all render threads of one build; projections are memoized per UUID, which the
 * immutable snapshot makes safe.
 *
 * <p>Dataset loops (M19.3.2) read a {@code dataset → records} index built once per resolver — that
 * is, once per snapshot — on first use, so a loop never scans the snapshot. The build is guarded by
 * {@link ConcurrentHashMap#computeIfAbsent}, which renders on parallel virtual threads rely on.
 */
final class SnapshotAssetValueResolver implements AssetValueResolver {

    private static final String INDEX_KEY = "records";

    private final Snapshot snapshot;
    private final Map<UUID, JsonNode> projections = new ConcurrentHashMap<>();
    private final Map<String, RecordIndex> recordIndex = new ConcurrentHashMap<>(1);
    private final AtomicInteger indexBuilds = new AtomicInteger();

    SnapshotAssetValueResolver(Snapshot snapshot) {
        this.snapshot = snapshot;
    }

    @Override
    public JsonNode valueOf(String assetType, UUID uuid) {
        return projections.computeIfAbsent(uuid, u -> project(assetType, u));
    }

    @Override
    public List<RecordView> datasetRecords(UUID datasetUuid) {
        return index().byDataset.getOrDefault(datasetUuid, List.of());
    }

    /** How many times the record index was built; exactly once per snapshot once a loop rendered. */
    int indexBuilds() {
        return indexBuilds.get();
    }

    private JsonNode project(String assetType, UUID uuid) {
        SnapshotAsset asset = snapshot.assetByUuid(uuid);
        AssetType expected = AssetReferencePrefixes.assetTypeForRef(assetType);
        if (asset == null || asset.type() != expected) {
            return MissingNode.getInstance();
        }
        if (asset.type() == AssetType.RECORD) {
            RecordView record = asset.deleted() ? null : index().byUuid.get(uuid);
            return record == null ? MissingNode.getInstance() : record.item();
        }
        return AssetValueProjection.project(asset.type(), asset.uid(), asset.displayName(), asset.payload(), asset.deleted());
    }

    private RecordIndex index() {
        return recordIndex.computeIfAbsent(INDEX_KEY, key -> buildIndex());
    }

    private RecordIndex buildIndex() {
        indexBuilds.incrementAndGet();
        Map<UUID, List<RecordView>> byDataset = new HashMap<>();
        Map<UUID, RecordView> byUuid = new HashMap<>();
        for (SnapshotAsset asset : snapshot.assetsOfType(AssetType.RECORD)) {
            UUID dataset = RecordValues.datasetRef(asset.payload());
            if (dataset == null) {
                continue;
            }
            RecordView view = RecordValues.view(
                    asset.uuid(), asset.uid(), asset.displayName(), asset.folderPath(), recordSetUid(asset.folderId()),
                    asset.changedAt(), asset.payload());
            byDataset.computeIfAbsent(dataset, d -> new ArrayList<>()).add(view);
            byUuid.put(asset.uuid(), view);
        }
        byDataset.replaceAll((dataset, records) -> List.copyOf(records));
        return new RecordIndex(Map.copyOf(byDataset), Map.copyOf(byUuid));
    }

    /** The uid of the record set with asset id {@code setId} in this snapshot, or {@code null}. */
    private String recordSetUid(Long setId) {
        SnapshotAsset set = setId == null ? null : snapshot.assetById(setId);
        return set == null ? null : set.uid();
    }

    private record RecordIndex(Map<UUID, List<RecordView>> byDataset, Map<UUID, RecordView> byUuid) {}
}
