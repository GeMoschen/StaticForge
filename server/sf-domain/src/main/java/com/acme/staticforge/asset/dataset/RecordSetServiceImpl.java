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
import com.acme.staticforge.asset.content.TemplateContentDefinitions;
import com.acme.staticforge.asset.dataset.RecordService.RecordListQuery;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.query.DatasetQuery;
import com.acme.staticforge.template.query.RecordSetQueries;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
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
 * folder cascade ({@link FolderService#delete}). Queries are validated, evaluated and checked on read only
 * through {@link RecordSetQueries} (M25.1.2).
 */
@Service
@RevisionAware
public class RecordSetServiceImpl implements RecordSetService {

    private final AssetService assetService;
    private final FolderService folderService;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final RevisionService revisionService;
    private final ProjectLocales projectLocales;
    private final ObjectMapper objectMapper;

    public RecordSetServiceImpl(
            AssetService assetService,
            FolderService folderService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            RevisionService revisionService,
            ProjectLocales projectLocales,
            ObjectMapper objectMapper) {
        this.assetService = assetService;
        this.folderService = folderService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.revisionService = revisionService;
        this.projectLocales = projectLocales;
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
        return toView(cmd.projectId(), created, 0, null);
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
        return toView(
                ctx.projectId(), updated, assetVersionRepository.countCurrentChildrenOfType(set.getId(), AssetType.RECORD), null);
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
            return toView(projectId, v, records, revision);
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
        Map<Long, ContentDefinition> definitions = new HashMap<>();
        for (AssetVersion dataset : assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.DATASET)) {
            datasetNames.put(dataset.getAssetId(), dataset.getDisplayName());
            definitions.put(dataset.getAssetId(), TemplateContentDefinitions.of(dataset.getPayload()));
        }

        List<RecordSetView> views = new ArrayList<>(sets.size());
        for (AssetVersion set : sets) {
            Asset asset = set.getAsset();
            Asset dataset = related.get(set.getTemplateAssetId());
            Asset folder = related.get(set.getFolderId());
            RecordSetQuery query = RecordSetQuery.fromJson(set.getPayload().get("query"));
            RecordSetQueries.Compiled compiled = RecordSetQueries.compile(query, definitions.get(set.getTemplateAssetId()));
            views.add(new RecordSetView(
                    asset.getUuid(),
                    asset.getUid(),
                    set.getDisplayName(),
                    RecordValues.datasetRef(set.getPayload()),
                    dataset == null ? null : dataset.getUid(),
                    dataset == null ? null : datasetNames.get(dataset.getId()),
                    folder == null ? null : folder.getUuid(),
                    ContentStorePaths.relative(set.getFolderPath()),
                    query,
                    compiled.valid(),
                    compiled.diagnostics(),
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

    @Override
    @Transactional(readOnly = true)
    public RecordSetQueryPreview previewQuery(long projectId, UUID uuid, RecordSetQuery draft) {
        Asset set = requireSet(projectId, uuid);
        AssetVersion current = requireLiveVersion(set);
        RecordSetQueries.Compiled compiled =
                RecordSetQueries.compile(RecordSetQuery.orAll(draft), currentDefinition(projectId, current));
        if (!compiled.valid()) {
            return new RecordSetQueryPreview(false, compiled.diagnostics(), 0, 0);
        }
        List<RecordView> records = recordsOf(set).stream().map(SetRecord::view).toList();
        List<String> chain = localeChain(projectId, null);
        return new RecordSetQueryPreview(
                true,
                compiled.diagnostics(),
                RecordSetQueries.count(records, compiled, chain),
                RecordSetQueries.select(records, compiled, chain).size());
    }

    @Override
    @Transactional(readOnly = true)
    public RecordPage listRecords(
            long projectId, UUID uuid, RecordListQuery query, boolean applySetQuery, String locale, int page, int size) {
        RecordGrid.checkPaging(page, size);
        Asset set = requireSet(projectId, uuid);
        AssetVersion current = requireLiveVersion(set);
        ContentDefinition definition = currentDefinition(projectId, current);
        DatasetQuery narrowing = RecordGrid.listingQuery(definition, query);
        RecordSetQuery setQuery =
                applySetQuery ? RecordSetQuery.fromJson(current.getPayload().get("query")) : RecordSetQuery.ALL;

        List<SetRecord> records = recordsOf(set);
        Map<UUID, RecordView> stored = new HashMap<>();
        Map<UUID, Long> changedBy = new HashMap<>();
        List<RecordView> views = new ArrayList<>(records.size());
        for (SetRecord record : records) {
            stored.put(record.view().uuid(), record.view());
            changedBy.put(record.view().uuid(), record.changedBy());
            views.add(record.view());
        }
        // The set query (without it: every record in the default order) comes first and the request narrows
        // its result; q filters last, so it never shifts the set query's offset/limit window.
        List<RecordView> selected = RecordSetQueries.select(
                views, RecordSetQueries.compile(setQuery, definition), localeChain(projectId, locale), narrowing, null);
        String q = query.q() == null || query.q().isBlank() ? null : query.q().strip().toLowerCase(Locale.ROOT);
        if (q != null) {
            selected = selected.stream()
                    .filter(record -> record.displayName().toLowerCase(Locale.ROOT).contains(q))
                    .toList();
        }
        return RecordGrid.page(selected, definition, stored, changedBy, page, size);
    }

    // ------------------------------------------------------------------
    // Query
    // ------------------------------------------------------------------

    /**
     * The query to store for a set of {@code dataset}, normalized, after checking it against the dataset's
     * current schema: an invalid query is {@code 422} with {@code diagnostics}, before anything is written.
     */
    private RecordSetQuery validatedQuery(Asset dataset, RecordSetQuery query) {
        ContentDefinition definition = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(dataset.getId())
                .map(version -> TemplateContentDefinitions.of(version.getPayload()))
                .orElse(null);
        RecordSetQueries.Compiled compiled = RecordSetQueries.compile(query, definition);
        if (!compiled.valid()) {
            throw new SfException(Problem.builder()
                    .type("https://cms.example.com/problems/sf-api-0422")
                    .title("Validation Failed")
                    .status(422)
                    .detail("The record set query is invalid: " + compiled.diagnostics().get(0).message())
                    .property("code", "SF-API-0422")
                    .property("diagnostics", compiled.diagnostics())
                    .build());
        }
        return compiled.source();
    }

    /** The current schema of the set's dataset; {@code null} when the dataset can't be read. */
    private ContentDefinition currentDefinition(long projectId, AssetVersion set) {
        return definitionAt(projectId, RecordValues.datasetRef(set.getPayload()), null);
    }

    /** The schema of dataset {@code datasetUuid} as of {@code revision} (current when {@code null}). */
    private ContentDefinition definitionAt(long projectId, UUID datasetUuid, Long revision) {
        if (datasetUuid == null) {
            return null;
        }
        Optional<JsonNode> payload = revision == null
                ? assetRepository.findByProjectIdAndUuid(projectId, datasetUuid)
                        .flatMap(asset -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                        .map(AssetVersion::getPayload)
                : assetService.findAt(projectId, datasetUuid, revision).map(AssetVersionView::payload);
        return payload.map(TemplateContentDefinitions::of).orElse(null);
    }

    /**
     * The fallback chain language-dependent values are compared in: {@code locale}'s, or the default
     * language's when it is {@code null}; empty in a project without languages.
     */
    private List<String> localeChain(long projectId, String locale) {
        LocaleConfig config = LocaleConfig.orEmpty(projectLocales.forProject(projectId));
        return config.effectiveChain(locale == null ? config.defaultLocale() : locale);
    }

    /** A live record of a set: its query view and its last editor. */
    private record SetRecord(RecordView view, Long changedBy) {}

    private List<SetRecord> recordsOf(Asset set) {
        List<SetRecord> records = new ArrayList<>();
        for (AssetVersion version : assetVersionRepository.findCurrentRecordsOfSet(set.getId())) {
            records.add(new SetRecord(
                    RecordValues.view(
                            version.getAsset().getUuid(), version.getAsset().getUid(), version.getDisplayName(),
                            version.getFolderPath(), set.getUid(), version.getChangedAt(), version.getPayload()),
                    version.getChangedBy()));
        }
        return records;
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

    /** @param revision the revision read at, whose dataset schema the query is checked against ({@code null}: current) */
    private RecordSetView toView(long projectId, AssetVersionView view, long recordCount, Long revision) {
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
        RecordSetQuery query = RecordSetQuery.fromJson(payload == null ? null : payload.get("query"));
        RecordSetQueries.Compiled compiled = RecordSetQueries.compile(query, definitionAt(projectId, datasetUuid, revision));
        return new RecordSetView(
                view.uuid(),
                view.uid(),
                view.displayName(),
                datasetUuid,
                dataset.map(Asset::getUid).orElse(null),
                datasetName,
                folderUuid,
                ContentStorePaths.relative(view.folderPath()),
                query,
                compiled.valid(),
                compiled.diagnostics(),
                recordCount,
                view.validFromRevision(),
                view.changedBy(),
                view.changedAt(),
                view.deleted());
    }
}
