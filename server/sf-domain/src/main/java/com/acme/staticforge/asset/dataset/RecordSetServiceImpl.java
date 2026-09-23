package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.ChildCount;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link RecordSetService} implementation (M25). Writes go through {@link AssetService} — which enforces
 * the containment rules — with the dataset passed as the create command's {@code templateUuid}, so
 * {@code template_asset_id} mirrors {@code payload.datasetRef} exactly as for records. A delete reuses the
 * folder cascade ({@link FolderService#delete}).
 */
@Service
@RevisionAware
public class RecordSetServiceImpl implements RecordSetService {

    private final AssetService assetService;
    private final FolderService folderService;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final RevisionService revisionService;
    private final ObjectMapper objectMapper;

    public RecordSetServiceImpl(
            AssetService assetService,
            FolderService folderService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            RevisionService revisionService,
            ObjectMapper objectMapper) {
        this.assetService = assetService;
        this.folderService = folderService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.revisionService = revisionService;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public RecordSetView create(CreateRecordSetCommand cmd, RevisionContext ctx) {
        Asset dataset = requireLiveDataset(cmd.projectId(), cmd.datasetUuid());
        RecordSetQuery query = validatedQuery(dataset, RecordSetQuery.orAll(cmd.query()));

        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("datasetRef", dataset.getUuid().toString());
        payload.set("query", query.toJson());

        // A project created before M19 has no Content store root yet: provisioning it (inside
        // AssetService.create) joins this creation's revision instead of adding one of its own.
        RevisionContext writeCtx = ctx.openRevision() != null
                ? ctx
                : RevisionContext.joining(
                        revisionService.beginBatch(ctx.projectId(), ChangeType.CREATE, ctx.comment(), ctx.userId()),
                        ctx.userId(),
                        ctx.comment());
        AssetVersionView created = assetService.create(
                new CreateAssetCommand(
                        cmd.projectId(),
                        AssetType.RECORD_SET,
                        cmd.displayName(),
                        cmd.folderUuid(),
                        payload,
                        dataset.getUuid(),
                        cmd.uid()),
                writeCtx);
        return toView(cmd.projectId(), created, 0);
    }

    @Override
    @Transactional
    public RecordSetView update(UUID uuid, UpdateRecordSetCommand cmd, long expectedRevision, RevisionContext ctx) {
        Asset set = requireSet(ctx.projectId(), uuid);
        AssetVersion current = requireLiveVersion(set);
        UUID datasetUuid = RecordValues.datasetRef(current.getPayload());
        Asset dataset = assetRepository.findByProjectIdAndUuid(ctx.projectId(), datasetUuid)
                .filter(asset -> asset.getAssetType() == AssetType.DATASET)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Dataset not found.")));
        RecordSetQuery query = validatedQuery(dataset, RecordSetQuery.orAll(cmd.query()));

        // datasetRef is immutable: the stored payload keeps it, only the query is replaced.
        ObjectNode payload = current.getPayload().deepCopy();
        payload.set("query", query.toJson());
        String name = cmd.displayName() == null || cmd.displayName().isBlank() ? current.getDisplayName() : cmd.displayName();
        AssetVersionView updated = assetService.update(uuid, new UpdateAssetCommand(name, payload), expectedRevision, ctx);
        return toView(ctx.projectId(), updated, assetVersionRepository.countCurrentChildrenOfType(set.getId(), AssetType.RECORD));
    }

    @Override
    @Transactional
    public void delete(UUID uuid, boolean cascade, RevisionContext ctx) {
        requireSet(ctx.projectId(), uuid);
        folderService.delete(uuid, cascade, ctx);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<RecordSetView> find(long projectId, UUID uuid, Long revision) {
        Optional<AssetVersionView> version = revision == null
                ? Optional.of(assetService.requireCurrent(projectId, uuid))
                : assetService.findAt(projectId, uuid, revision);
        return version.filter(v -> v.type() == AssetType.RECORD_SET).map(v -> {
            long setId = requireSet(projectId, uuid).getId();
            long records = revision == null
                    ? assetVersionRepository.countCurrentChildrenOfType(setId, AssetType.RECORD)
                    : assetVersionRepository.countChildrenOfTypeAt(setId, AssetType.RECORD, revision);
            return toView(projectId, v, records);
        });
    }

    @Override
    @Transactional(readOnly = true)
    public List<RecordSetView> list(long projectId, UUID datasetUuid) {
        List<AssetVersion> sets = datasetUuid == null
                ? assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.RECORD_SET)
                : assetVersionRepository.findCurrentSetsOfDataset(projectId, requireDataset(projectId, datasetUuid).getId());

        Map<Long, Long> recordCounts = new HashMap<>();
        for (ChildCount count : assetVersionRepository.countCurrentRecordsPerSet(projectId)) {
            recordCounts.put(count.folderId(), count.count());
        }
        Set<Long> relatedIds = new HashSet<>();
        sets.forEach(set -> {
            relatedIds.add(set.getFolderId());
            relatedIds.add(set.getTemplateAssetId());
        });
        relatedIds.remove(null);
        Map<Long, Asset> related = new HashMap<>();
        assetRepository.findAllById(relatedIds).forEach(asset -> related.put(asset.getId(), asset));
        Map<Long, String> datasetNames = new HashMap<>();
        for (AssetVersion dataset : assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.DATASET)) {
            datasetNames.put(dataset.getAssetId(), dataset.getDisplayName());
        }

        List<RecordSetView> views = new ArrayList<>(sets.size());
        for (AssetVersion set : sets) {
            Asset asset = set.getAsset();
            Asset dataset = related.get(set.getTemplateAssetId());
            Asset folder = related.get(set.getFolderId());
            views.add(new RecordSetView(
                    asset.getUuid(),
                    asset.getUid(),
                    set.getDisplayName(),
                    RecordValues.datasetRef(set.getPayload()),
                    dataset == null ? null : dataset.getUid(),
                    dataset == null ? null : datasetNames.get(dataset.getId()),
                    folder == null ? null : folder.getUuid(),
                    ContentStorePaths.relative(set.getFolderPath()),
                    RecordSetQuery.fromJson(set.getPayload().get("query")),
                    recordCounts.getOrDefault(asset.getId(), 0L),
                    set.getValidFromRevision(),
                    set.getChangedBy(),
                    set.getChangedAt(),
                    set.isDeleted()));
        }
        views.sort(Comparator.comparing(RecordSetView::displayName, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(RecordSetView::uid));
        return views;
    }

    // ------------------------------------------------------------------
    // Query
    // ------------------------------------------------------------------

    /**
     * The query to store for a set of {@code dataset}. Stored as given for now; validating it against
     * the dataset's schema ({@code SF-TPL-0140..0142}) is the job of M25.1.2, which plugs in here for both
     * create and update.
     */
    @SuppressWarnings("unused") // the dataset's schema is what M25.1.2 validates against
    private RecordSetQuery validatedQuery(Asset dataset, RecordSetQuery query) {
        return query;
    }

    // ------------------------------------------------------------------
    // Lookups and views
    // ------------------------------------------------------------------

    /** A record set of this project; another type or project is the same {@code 404}. */
    private Asset requireSet(long projectId, UUID uuid) {
        return assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .filter(asset -> asset.getAssetType() == AssetType.RECORD_SET)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Record set not found.")));
    }

    private AssetVersion requireLiveVersion(Asset set) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(set.getId())
                .filter(version -> !version.isDeleted())
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Record set not found.")));
    }

    private Asset requireDataset(long projectId, UUID uuid) {
        if (uuid == null) {
            throw new SfException(ProblemFactory.notFound("Dataset not found."));
        }
        return assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .filter(asset -> asset.getAssetType() == AssetType.DATASET)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Dataset not found.")));
    }

    private Asset requireLiveDataset(long projectId, UUID uuid) {
        Asset dataset = requireDataset(projectId, uuid);
        boolean live = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(dataset.getId())
                .map(version -> !version.isDeleted())
                .orElse(false);
        if (!live) {
            throw new SfException(ProblemFactory.notFound("Dataset not found."));
        }
        return dataset;
    }

    private RecordSetView toView(long projectId, AssetVersionView view, long recordCount) {
        UUID datasetUuid = RecordValues.datasetRef(view.payload());
        Optional<Asset> dataset = datasetUuid == null
                ? Optional.empty()
                : assetRepository.findByProjectIdAndUuid(projectId, datasetUuid);
        String datasetName = dataset
                .flatMap(asset -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                .map(AssetVersion::getDisplayName)
                .orElse(null);
        UUID folderUuid = view.folderId() == null
                ? null
                : assetRepository.findById(view.folderId()).map(Asset::getUuid).orElse(null);
        JsonNode payload = view.payload();
        return new RecordSetView(
                view.uuid(),
                view.uid(),
                view.displayName(),
                datasetUuid,
                dataset.map(Asset::getUid).orElse(null),
                datasetName,
                folderUuid,
                ContentStorePaths.relative(view.folderPath()),
                RecordSetQuery.fromJson(payload == null ? null : payload.get("query")),
                recordCount,
                view.validFromRevision(),
                view.changedBy(),
                view.changedAt(),
                view.deleted());
    }
}
