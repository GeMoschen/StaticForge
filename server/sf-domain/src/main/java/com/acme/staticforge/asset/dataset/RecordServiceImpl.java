package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.RecordNaming;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.folder.RecordSetContainment;
import com.acme.staticforge.asset.page.PageContentValidation;
import com.acme.staticforge.asset.rules.ContentRules;
import com.acme.staticforge.asset.rules.RuleEngine;
import com.acme.staticforge.asset.rules.SaveFindings;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.query.DatasetQuery;
import com.acme.staticforge.template.query.DatasetQueryEvaluator;
import com.acme.staticforge.template.query.RecordView;
import com.acme.staticforge.template.rules.RuleScope;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link RecordService} implementation (M19.1.2). Writes go through {@link AssetService}: the
 * dataset link is passed as the create command's {@code templateUuid}, which is what fills
 * {@code template_asset_id} and what every later version write carries forward, so it cannot drift
 * from {@code payload.datasetRef}.
 */
@Service
@RevisionAware
public class RecordServiceImpl implements RecordService {

    private static final String CONTENT_PATH = "content";
    private static final int MAX_DISPLAY_NAME = 200;

    private final AssetService assetService;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final PageContentValidation pageContentValidation;
    private final RecordDatasets recordDatasets;
    private final ContentRules contentRules;
    private final ObjectMapper objectMapper;
    private final CdlCompiler cdlCompiler = new CdlCompiler();

    public RecordServiceImpl(
            AssetService assetService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            PageContentValidation pageContentValidation,
            RecordDatasets recordDatasets,
            ContentRules contentRules,
            ObjectMapper objectMapper) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.pageContentValidation = pageContentValidation;
        this.recordDatasets = recordDatasets;
        this.contentRules = contentRules;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public RecordWriteResult create(CreateRecordCommand cmd, RevisionContext ctx) {
        AssetVersion set = requireRecordSet(cmd.projectId(), cmd.recordSetUuid());
        Dataset dataset = requireLiveDataset(cmd.projectId(), RecordValues.datasetRef(set.getPayload()));
        JsonNode incoming = contentOrEmpty(cmd.content());
        validate(cmd.projectId(), dataset, incoming);

        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("datasetRef", dataset.uuid().toString());
        UUID uuid = UUID.randomUUID();
        SaveFindings.Captured<JsonNode> saved = SaveFindings.capture(() -> contentRules.saveContent(
                cmd.projectId(), null, AssetType.RECORD, dataset.definition(), payload, null, incoming));
        JsonNode content = saved.value();
        payload.set("content", content);

        String displayName = titleOf(dataset, content).orElse(uuid.toString());
        AssetVersionView created = assetService.create(
                new CreateAssetCommand(
                        cmd.projectId(), AssetType.RECORD, displayName, cmd.recordSetUuid(), payload, dataset.uuid(),
                        RecordNaming.uidOf(uuid), uuid),
                ctx);
        List<ContentIssue> issues = issues(cmd.projectId(), uuid, dataset, payload, saved.findings());
        return new RecordWriteResult(toDetail(cmd.projectId(), created), issues);
    }

    @Override
    @Transactional
    public RecordWriteResult update(UUID uuid, JsonNode content, long expectedRevision, RevisionContext ctx) {
        AssetVersion current = requireOpenRecord(ctx.projectId(), uuid);
        UUID datasetUuid = RecordValues.datasetRef(current.getPayload());
        Dataset dataset = requireDataset(ctx.projectId(), datasetUuid);
        JsonNode incoming = contentOrEmpty(content);
        validate(ctx.projectId(), dataset, incoming);

        // datasetRef is immutable: the stored payload keeps it, only the values are replaced.
        ObjectNode payload = current.getPayload().deepCopy();
        SaveFindings.Captured<JsonNode> saved = SaveFindings.capture(() -> contentRules.saveContent(
                ctx.projectId(), uuid, AssetType.RECORD, dataset.definition(), current.getPayload(),
                current.getPayload().get("content"), incoming));
        JsonNode values = saved.value();
        payload.set("content", values);
        List<ContentIssue> issues = issues(ctx.projectId(), uuid, dataset, payload, saved.findings());

        String name = titleOf(dataset, values).orElse(current.getDisplayName());
        AssetVersionView updated = assetService.update(uuid, new UpdateAssetCommand(name, payload), expectedRevision, ctx);
        return new RecordWriteResult(toDetail(ctx.projectId(), updated), issues);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<RecordDetail> find(long projectId, UUID uuid, Long revision) {
        Optional<AssetVersionView> version = revision == null
                ? Optional.of(assetService.requireCurrent(projectId, uuid))
                : assetService.findAt(projectId, uuid, revision);
        return version.filter(v -> v.type() == AssetType.RECORD).map(v -> toDetail(projectId, v));
    }

    @Override
    @Transactional(readOnly = true)
    public RecordPage list(long projectId, UUID datasetUuid, RecordListQuery query, int page, int size) {
        RecordGrid.checkPaging(page, size);
        Dataset dataset = requireDataset(projectId, datasetUuid);
        DatasetQuery datasetQuery = RecordGrid.listingQuery(dataset.definition(), query);

        // Dataset membership, q and folder narrow the rows in SQL; where and sort run in memory over
        // what is left (v1 sizes, see M19.2.1 — pushing where into SQL would break H2 portability).
        List<RecordView> candidates = new ArrayList<>();
        Map<UUID, Long> changedBy = new HashMap<>();
        List<AssetVersion> versions = assetVersionRepository.searchCurrentRecordsOfDataset(
                projectId, dataset.assetId(), likeContains(query.q()), folderPattern(query.folder()));
        Map<Long, String> setUids = RecordValues.recordSetUids(assetRepository, versions);
        for (AssetVersion version : versions) {
            candidates.add(RecordValues.view(
                    version.getAsset().getUuid(), version.getAsset().getUid(), version.getDisplayName(),
                    version.getFolderPath(), setUids.get(version.getFolderId()), version.getChangedAt(),
                    version.getPayload()));
            changedBy.put(version.getAsset().getUuid(), version.getChangedBy());
        }
        List<RecordView> selected = DatasetQueryEvaluator.apply(candidates, datasetQuery, null);
        return RecordGrid.page(selected, dataset.definition(), null, changedBy, null, page, size);
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    @Override
    @Transactional(readOnly = true)
    public List<ContentIssue> contentIssues(long projectId, UUID uuid, JsonNode payload) {
        UUID datasetUuid = RecordValues.datasetRef(payload);
        if (datasetUuid == null) {
            return List.of();
        }
        Dataset dataset;
        try {
            dataset = requireDataset(projectId, datasetUuid);
        } catch (SfException e) {
            return List.of();
        }
        return issues(projectId, uuid, dataset, payload, List.of());
    }

    /**
     * What a record's editor shows (M33.4): the {@code edit} outcome of its stored values — built-ins and the dataset's
     * rules — plus the {@code read-only} notes of the save that stored them.
     */
    private List<ContentIssue> issues(
            long projectId, UUID uuid, Dataset dataset, JsonNode payload, List<ContentIssue> saveFindings) {
        List<ContentIssue> out = new ArrayList<>(saveFindings.stream()
                .filter(f -> RuleEngine.CODE_READ_ONLY.equals(f.code()))
                .toList());
        out.addAll(contentRules.content(projectId, uuid, AssetType.RECORD, dataset.definition(), payload,
                payload.path("content"), RuleScope.EDIT, null).findings());
        return out;
    }

    /** Rejects structural findings with {@code 422}; returns completeness findings, which save. */
    private List<ContentIssue> validate(long projectId, Dataset dataset, JsonNode content) {
        List<ContentIssue> issues = recordDatasets.validator(projectId).validate(
                dataset.definition(), content, pageContentValidation.sectionTemplates(projectId), CONTENT_PATH);
        List<ContentIssue> structural = issues.stream()
                .filter(issue -> issue.kind() == ContentIssue.Kind.STRUCTURAL)
                .toList();
        if (!structural.isEmpty()) {
            ContentIssue first = structural.get(0);
            String detail = "Record content is invalid: " + first.path() + " — " + first.message()
                    + (structural.size() > 1 ? " (+" + (structural.size() - 1) + " more)" : "");
            throw new SfException(ProblemFactory.unprocessableEntity(detail, "issues", structural));
        }
        return issues;
    }

    // ------------------------------------------------------------------
    // Title, lookups, views
    // ------------------------------------------------------------------

    /** The dataset's title editor value, trimmed and capped, when the dataset has one and it is set. */
    private static Optional<String> titleOf(Dataset dataset, JsonNode content) {
        if (dataset.titleEditor() == null) {
            return Optional.empty();
        }
        JsonNode value = content.get(dataset.titleEditor());
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            return Optional.empty();
        }
        String title = value.asText().trim();
        return Optional.of(title.length() > MAX_DISPLAY_NAME ? title.substring(0, MAX_DISPLAY_NAME) : title);
    }

    private JsonNode contentOrEmpty(JsonNode content) {
        if (content == null || content.isNull() || content.isMissingNode()) {
            return objectMapper.createObjectNode();
        }
        if (!content.isObject()) {
            throw new SfException(ProblemFactory.unprocessableEntity("content must be an object."));
        }
        return content;
    }

    private Dataset requireLiveDataset(long projectId, UUID datasetUuid) {
        Dataset dataset = requireDataset(projectId, datasetUuid);
        if (dataset.deleted()) {
            throw new SfException(ProblemFactory.notFound("Dataset not found."));
        }
        return dataset;
    }

    /** The dataset (deleted ones included, so existing records stay editable in theory) or {@code 404}. */
    private Dataset requireDataset(long projectId, UUID datasetUuid) {
        if (datasetUuid == null) {
            throw new SfException(ProblemFactory.notFound("Dataset not found."));
        }
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, datasetUuid)
                .filter(a -> a.getAssetType() == AssetType.DATASET)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Dataset not found.")));
        AssetVersion version = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Dataset not found.")));
        JsonNode payload = version.getPayload();
        ContentDefinition definition = cdlCompiler.compile(payload.path("contentDefinition").asText("")).definition();
        JsonNode titleEditor = payload.get("titleEditor");
        return new Dataset(
                asset.getId(),
                asset.getUuid(),
                asset.getUid(),
                definition,
                titleEditor != null && titleEditor.isTextual() ? titleEditor.asText() : null,
                version.isDeleted());
    }

    /**
     * The current version of the live record set a new record goes into. Without one — no uuid, a folder,
     * another type, a deleted set — the containment rules reject the record ({@code 422 SF-DOM-0104}); a
     * uuid unknown to the project is {@code 404}.
     */
    private AssetVersion requireRecordSet(long projectId, UUID recordSetUuid) {
        if (recordSetUuid == null) {
            RecordSetContainment.require(AssetType.RECORD, null, AssetType.FOLDER, null, false);
        }
        Asset parent = assetRepository.findByProjectIdAndUuid(projectId, recordSetUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Record set not found.")));
        AssetVersion version = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(parent.getId())
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Record set not found.")));
        if (parent.getAssetType() != AssetType.RECORD_SET || version.isDeleted()) {
            RecordSetContainment.require(
                    AssetType.RECORD, null, parent.getAssetType(), version.getPayload(), version.isDeleted());
        }
        return version;
    }

    /** A live record of this project; another type, project or a deleted record is {@code 404}. */
    private AssetVersion requireOpenRecord(long projectId, UUID uuid) {
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .filter(a -> a.getAssetType() == AssetType.RECORD)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Record not found.")));
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                .filter(version -> !version.isDeleted())
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Record not found.")));
    }

    private RecordDetail toDetail(long projectId, AssetVersionView view) {
        UUID datasetUuid = RecordValues.datasetRef(view.payload());
        String datasetUid = datasetUuid == null
                ? null
                : assetRepository.findByProjectIdAndUuid(projectId, datasetUuid).map(Asset::getUid).orElse(null);
        // A record's parent is its set (M25); the set's own parent is the Content folder it lives in.
        Optional<Asset> set = view.folderId() == null ? Optional.empty() : assetRepository.findById(view.folderId());
        Optional<AssetVersion> setVersion =
                set.flatMap(s -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(s.getId()));
        UUID folderUuid = setVersion
                .map(AssetVersion::getFolderId)
                .flatMap(assetRepository::findById)
                .map(Asset::getUuid)
                .orElse(null);
        JsonNode content = view.payload() == null ? null : view.payload().get("content");
        return new RecordDetail(
                view.uuid(),
                view.uid(),
                view.displayName(),
                datasetUuid,
                datasetUid,
                set.map(Asset::getUuid).orElse(null),
                set.map(Asset::getUid).orElse(null),
                setVersion.map(AssetVersion::getDisplayName).orElse(null),
                folderUuid,
                ContentStorePaths.relative(view.folderPath()),
                content == null ? objectMapper.createObjectNode() : content,
                view.validFromRevision(),
                view.changedBy(),
                view.changedAt(),
                view.deleted());
    }

    private static String likeContains(String q) {
        return q == null || q.isBlank() ? null : escapeLike(q.trim());
    }

    private static String folderPattern(String folder) {
        return folder == null || folder.isBlank() ? null : escapeLike(ContentStorePaths.stored(folder)) + "%";
    }

    private static String escapeLike(String value) {
        return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    private record Dataset(
            long assetId, UUID uuid, String uid, ContentDefinition definition, String titleEditor, boolean deleted) {}
}
