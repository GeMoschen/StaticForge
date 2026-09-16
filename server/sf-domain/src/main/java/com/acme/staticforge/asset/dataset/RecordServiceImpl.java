package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.page.PageContentValidation;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.octl.OctlExpressions;
import com.acme.staticforge.template.query.DatasetQuery;
import com.acme.staticforge.template.query.DatasetQueryEvaluator;
import com.acme.staticforge.template.query.DatasetQueryParser;
import com.acme.staticforge.template.query.RecordView;
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
    private final ObjectMapper objectMapper;
    private final RevisionService revisionService;
    private final CdlCompiler cdlCompiler = new CdlCompiler();

    public RecordServiceImpl(
            AssetService assetService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            PageContentValidation pageContentValidation,
            RecordDatasets recordDatasets,
            ObjectMapper objectMapper,
            RevisionService revisionService) {
        this.revisionService = revisionService;
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.pageContentValidation = pageContentValidation;
        this.recordDatasets = recordDatasets;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public RecordWriteResult create(CreateRecordCommand cmd, RevisionContext ctx) {
        Dataset dataset = requireLiveDataset(cmd.projectId(), cmd.datasetUuid());
        JsonNode content = contentOrEmpty(cmd.content());
        List<ContentIssue> issues = validate(cmd.projectId(), dataset, content);

        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("datasetRef", dataset.uuid().toString());
        payload.set("content", content);

        String displayName = titleOf(dataset, content).orElse(cmd.displayName());
        if (displayName == null || displayName.isBlank()) {
            throw new SfException(ProblemFactory.badRequest(
                    "displayName must not be blank (the dataset has no title editor value to use)."));
        }
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
                        cmd.projectId(), AssetType.RECORD, displayName, cmd.folderUuid(), payload, dataset.uuid()),
                writeCtx);
        return new RecordWriteResult(toDetail(cmd.projectId(), created), issues);
    }

    @Override
    @Transactional
    public RecordWriteResult update(
            UUID uuid, JsonNode content, String displayName, long expectedRevision, RevisionContext ctx) {
        AssetVersion current = requireOpenRecord(ctx.projectId(), uuid);
        UUID datasetUuid = RecordValues.datasetRef(current.getPayload());
        Dataset dataset = requireDataset(ctx.projectId(), datasetUuid);
        JsonNode values = contentOrEmpty(content);
        List<ContentIssue> issues = validate(ctx.projectId(), dataset, values);

        // datasetRef is immutable: the stored payload keeps it, only the values are replaced.
        ObjectNode payload = current.getPayload().deepCopy();
        payload.set("content", values);

        String name = titleOf(dataset, values)
                .orElse(displayName == null || displayName.isBlank() ? current.getDisplayName() : displayName);
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
        if (page < 0 || size < 1 || size > 500) {
            throw new SfException(ProblemFactory.badRequest("page must be >= 0 and size between 1 and 500."));
        }
        Dataset dataset = requireDataset(projectId, datasetUuid);
        DatasetQuery datasetQuery = listingQuery(dataset, query);

        // Dataset membership, q and folder narrow the rows in SQL; where and sort run in memory over
        // what is left (v1 sizes, see M19.2.1 — pushing where into SQL would break H2 portability).
        List<RecordView> candidates = new ArrayList<>();
        Map<UUID, Long> changedBy = new HashMap<>();
        for (AssetVersion version : assetVersionRepository.searchCurrentRecordsOfDataset(
                projectId, dataset.assetId(), likeContains(query.q()), folderPattern(query.folder()))) {
            candidates.add(RecordValues.view(
                    version.getAsset().getUuid(), version.getAsset().getUid(), version.getDisplayName(),
                    version.getFolderPath(), version.getChangedAt(), version.getPayload()));
            changedBy.put(version.getAsset().getUuid(), version.getChangedBy());
        }
        List<RecordView> selected = DatasetQueryEvaluator.apply(candidates, datasetQuery, null);
        int from = (int) Math.min((long) page * size, selected.size());
        int to = Math.min(from + size, selected.size());

        List<String> scalarFields = scalarFields(dataset.definition());
        List<RecordPage.Row> rows = new ArrayList<>(to - from);
        for (RecordView record : selected.subList(from, to)) {
            ObjectNode values = objectMapper.createObjectNode();
            for (String field : scalarFields) {
                JsonNode value = record.content().get(field);
                if (value != null && value.isValueNode()) {
                    values.set(field, value);
                }
            }
            rows.add(new RecordPage.Row(
                    record.uuid(), record.uid(), record.displayName(), record.folderPath(), record.changedAt(),
                    changedBy.get(record.uuid()), values));
        }
        return new RecordPage(rows, selected.size(), page, size);
    }

    /** The names of the schema's scalar editors, groups being transparent. */
    private static List<String> scalarFields(ContentDefinition definition) {
        List<String> fields = new ArrayList<>();
        collectScalar(definition.editors(), fields);
        return fields;
    }

    private static void collectScalar(List<EditorDefinition> editors, List<String> fields) {
        for (EditorDefinition editor : editors) {
            if (editor.isGroup()) {
                collectScalar(editor.items(), fields);
            } else if (DatasetQueryParser.SCALAR_TYPES.contains(editor.type())) {
                fields.add(editor.name());
            }
        }
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

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

    /** The listing's where/sort as a query over bare field names; invalid input is a {@code 400}. */
    private static DatasetQuery listingQuery(Dataset dataset, RecordListQuery query) {
        com.acme.staticforge.template.octl.Expr where = null;
        if (query.where() != null && !query.where().isBlank()) {
            OctlExpressions.Parsed parsed = OctlExpressions.parse(query.where());
            if (!parsed.ok()) {
                throw badQuery("Invalid where expression at column " + parsed.column() + ": " + parsed.error(),
                        parsed.column());
            }
            List<Diagnostic> rootErrors =
                    DatasetQueryParser.parse(Map.of("where", query.where()), null, 0, 0).diagnostics();
            if (!rootErrors.isEmpty()) {
                throw badQuery(rootErrors.get(0).message(), 0);
            }
            where = parsed.expr();
        }
        DatasetQuery datasetQuery = new DatasetQuery(null, where, query.sort(), null, null, null);
        List<Diagnostic> fieldErrors = DatasetQueryParser.validateFields(datasetQuery, dataset.definition(), 0, 0);
        if (!fieldErrors.isEmpty()) {
            throw badQuery(fieldErrors.get(0).message(), 0);
        }
        return datasetQuery;
    }

    private static SfException badQuery(String detail, int column) {
        Problem.Builder problem = Problem.builder()
                .type("https://cms.example.com/problems/sf-api-0400")
                .title("Bad Request")
                .status(400)
                .detail(detail)
                .property("code", "SF-API-0400");
        if (column > 0) {
            problem.property("column", column);
        }
        return new SfException(problem.build());
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
        UUID folderUuid = view.folderId() == null
                ? null
                : assetRepository.findById(view.folderId()).map(Asset::getUuid).orElse(null);
        JsonNode content = view.payload() == null ? null : view.payload().get("content");
        return new RecordDetail(
                view.uuid(),
                view.uid(),
                view.displayName(),
                datasetUuid,
                datasetUid,
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
