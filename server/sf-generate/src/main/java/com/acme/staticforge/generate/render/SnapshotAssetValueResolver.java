package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.content.AssetValueProjection;
import com.acme.staticforge.asset.dataset.RecordValues;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.asset.template.TemplateCompileMemo;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.template.cdl.CdlSources;
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
 *
 * <p>Record sets (M25.2.2) read a {@code set → records} view built in the same single pass as the dataset index, so
 * rendering a set never scans the snapshot either; each set's stored query is compiled once per build against its
 * dataset's schema from the build's compile memo (the same definition instance its record template compiles with).
 */
final class SnapshotAssetValueResolver implements AssetValueResolver {

    private static final String INDEX_KEY = "records";

    private final Snapshot snapshot;
    private final TemplateCompileMemo definitions;
    /** The view's locale chain: a localized media file reads as the file this locale renders (M27.3.2). */
    private final List<String> mediaChain;
    private final Map<UUID, JsonNode> projections = new ConcurrentHashMap<>();
    private final Map<String, RecordIndex> recordIndex = new ConcurrentHashMap<>(1);
    private final Map<UUID, Optional<RecordSetSource>> recordSets = new ConcurrentHashMap<>();
    private final AtomicInteger indexBuilds = new AtomicInteger();

    /** @param definitions the build's compile memo, the source of the datasets' schemas */
    SnapshotAssetValueResolver(Snapshot snapshot, TemplateCompileMemo definitions) {
        this(snapshot, definitions, LocaleConfig.EMPTY);
    }

    /** @param locales the project's locales: which file of a localized media the view's locale reads */
    SnapshotAssetValueResolver(
            Snapshot snapshot, TemplateCompileMemo definitions, LocaleConfig locales) {
        this.snapshot = snapshot;
        this.definitions = definitions;
        this.mediaChain = LocaleConfig.orEmpty(locales).effectiveChain(snapshot.locale());
    }

    @Override
    public JsonNode valueOf(String assetType, UUID uuid) {
        return projections.computeIfAbsent(uuid, u -> project(assetType, u));
    }

    @Override
    public List<RecordView> datasetRecords(UUID datasetUuid) {
        return index().byDataset.getOrDefault(datasetUuid, List.of());
    }

    /**
     * The record set as of the snapshot revision: its stored query compiled against its dataset's schema, and its
     * live records from the snapshot index. A missing or soft-deleted set is {@code null}. Built once per set and
     * build.
     */
    @Override
    public RecordSetSource recordSet(UUID setUuid) {
        return recordSets.computeIfAbsent(setUuid, this::loadSet).orElse(null);
    }

    private Optional<RecordSetSource> loadSet(UUID setUuid) {
        SnapshotAsset set = snapshot.assetByUuid(setUuid);
        if (set == null || set.type() != AssetType.RECORD_SET || set.deleted()) {
            return Optional.empty();
        }
        UUID datasetUuid = RecordValues.datasetRef(set.payload());
        SnapshotAsset dataset = datasetUuid == null ? null : snapshot.assetByUuid(datasetUuid);
        ContentDefinition definition = dataset == null || dataset.payload() == null
                ? null
                : definitions.definition(datasetUuid, CdlSources.of(dataset.payload()));
        JsonNode query = set.payload() == null ? null : set.payload().get("query");
        return Optional.of(new RecordSetSource(
                setUuid,
                set.uid(),
                set.displayName(),
                datasetUuid,
                dataset == null ? null : dataset.uid(),
                RecordSetQueries.compile(RecordSetQuery.fromJson(query), definition),
                definition,
                index().bySet.getOrDefault(setUuid, List.of())));
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
        JsonNode payload = asset.type() == AssetType.MEDIA
                ? MediaFiles.effective(asset.payload(), snapshot.locale(), mediaChain)
                : asset.payload();
        return AssetValueProjection.project(asset.type(), asset.uid(), asset.displayName(), payload, asset.deleted());
    }

    private RecordIndex index() {
        return recordIndex.computeIfAbsent(INDEX_KEY, key -> buildIndex());
    }

    private RecordIndex buildIndex() {
        indexBuilds.incrementAndGet();
        Map<UUID, List<RecordView>> byDataset = new HashMap<>();
        Map<UUID, List<RecordView>> bySet = new HashMap<>();
        Map<UUID, RecordView> byUuid = new HashMap<>();
        for (SnapshotAsset asset : snapshot.assetsOfType(AssetType.RECORD)) {
            UUID dataset = RecordValues.datasetRef(asset.payload());
            if (dataset == null) {
                continue;
            }
            SnapshotAsset set = asset.folderId() == null ? null : snapshot.assetById(asset.folderId());
            RecordView view = RecordValues.view(
                    asset.uuid(), asset.uid(), asset.displayName(), asset.folderPath(), set == null ? null : set.uid(),
                    asset.changedAt(), asset.payload());
            byDataset.computeIfAbsent(dataset, d -> new ArrayList<>()).add(view);
            if (set != null && set.type() == AssetType.RECORD_SET) {
                bySet.computeIfAbsent(set.uuid(), s -> new ArrayList<>()).add(view);
            }
            byUuid.put(asset.uuid(), view);
        }
        byDataset.replaceAll((dataset, records) -> List.copyOf(records));
        bySet.replaceAll((set, records) -> List.copyOf(records));
        return new RecordIndex(Map.copyOf(byDataset), Map.copyOf(bySet), Map.copyOf(byUuid));
    }

    /** The live records of the snapshot by dataset, by the record set holding them (M25.2.2), and by uuid. */
    private record RecordIndex(
            Map<UUID, List<RecordView>> byDataset, Map<UUID, List<RecordView>> bySet, Map<UUID, RecordView> byUuid) {}
}
