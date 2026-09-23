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
import com.acme.staticforge.asset.content.ContentRenameMigrator.EditorRename;
import com.acme.staticforge.asset.content.ContentRenameMigrator;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.cdl.DatasetCdlRules;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.Severity;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link DatasetService} implementation (M19.1.2).
 *
 * <p>Persisted writes route through {@link AssetService}, so revision allocation, {@code If-Match},
 * folder-scope checks (a dataset belongs in the {@code datasets} folder tree), uid derivation,
 * summaries and reference materialization are the generic ones. This class adds compiling the
 * schema and the one cross-asset step: the {@code renamedFrom} migration of the dataset's records.
 */
@Service
@RevisionAware
public class DatasetServiceImpl implements DatasetService {

    private static final String PROBLEM_TYPE_422 = "https://cms.example.com/problems/sf-api-0422";

    private final AssetService assetService;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final RevisionService revisionService;
    private final RecordRenameMigration recordRenameMigration;
    private final RecordSetQueryMigration recordSetQueryMigration;
    private final ObjectMapper objectMapper;
    private final com.acme.staticforge.project.ProjectLocales projectLocales;
    private final com.acme.staticforge.asset.localization.LocalizationMigrationService localizationMigrations;
    private final CdlCompiler cdlCompiler = new CdlCompiler();

    public DatasetServiceImpl(
            AssetService assetService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            RevisionService revisionService,
            RecordRenameMigration recordRenameMigration,
            RecordSetQueryMigration recordSetQueryMigration,
            ObjectMapper objectMapper,
            com.acme.staticforge.project.ProjectLocales projectLocales,
            com.acme.staticforge.asset.localization.LocalizationMigrationService localizationMigrations) {
        this.recordRenameMigration = recordRenameMigration;
        this.recordSetQueryMigration = recordSetQueryMigration;
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.revisionService = revisionService;
        this.objectMapper = objectMapper;
        this.projectLocales = projectLocales;
        this.localizationMigrations = localizationMigrations;
    }

    @Override
    @Transactional
    public DatasetView create(CreateDatasetCommand cmd, RevisionContext ctx) {
        ContentDefinition definition = compile(cmd.contentDefinition());
        String titleEditor = validTitleEditor(definition, cmd.titleEditor());
        // A project created before M19 has no `datasets` folder yet: provisioning it joins this
        // creation's revision instead of adding one of its own.
        RevisionContext writeCtx = joinOrBegin(ctx);
        UUID parent = cmd.parentFolderUuid() != null
                ? cmd.parentFolderUuid()
                : assetService.ensureTemplateFolders(cmd.projectId(), writeCtx).get(AssetType.DATASET).uuid();

        AssetVersionView created = assetService.create(
                new CreateAssetCommand(
                        cmd.projectId(),
                        AssetType.DATASET,
                        cmd.displayName(),
                        parent,
                        payload(cmd.contentDefinition(), definition, titleEditor, cmd.description()),
                        null),
                writeCtx);
        return toView(cmd.projectId(), created);
    }

    @Override
    @Transactional
    public DatasetView update(UUID uuid, UpdateDatasetCommand cmd, long expectedRevision, RevisionContext ctx) {
        return update(uuid, cmd, expectedRevision, false, ctx);
    }

    @Override
    @Transactional
    public DatasetView update(
            UUID uuid, UpdateDatasetCommand cmd, long expectedRevision, boolean confirmDiscard, RevisionContext ctx) {
        Asset dataset = requireDataset(ctx.projectId(), uuid);
        requireLive(dataset);
        ContentDefinition definition = compile(cmd.contentDefinition());
        String titleEditor = validTitleEditor(definition, cmd.titleEditor());
        ObjectNode payload = payload(cmd.contentDefinition(), definition, titleEditor, cmd.description());
        boolean localizationChanged = localizableFlagsChanged(dataset, definition);

        List<EditorRename> renames = ContentRenameMigrator.collect(definition);
        AssetVersionView updated;
        if (renames.isEmpty() && !localizationChanged) {
            updated = assetService.update(uuid, new UpdateAssetCommand(cmd.displayName(), payload), expectedRevision, ctx);
        } else {
            // The schema change and the rewrites it causes are one logical change: one revision listing the
            // dataset, every rewritten record set query and every rewritten record (§12.3, M15). A stale
            // If-Match on the dataset throws before anything is written, and the transaction rolls the batch
            // revision back. The batch holds the project's revision lock, so the sets and records read after
            // it cannot change under us.
            Revision batch = revisionService.beginBatch(ctx.projectId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
            RevisionContext batchCtx = RevisionContext.joining(batch, ctx.userId(), ctx.comment());
            updated = assetService.update(
                    uuid, new UpdateAssetCommand(cmd.displayName(), payload), expectedRevision, batchCtx);
            if (!renames.isEmpty()) {
                // Sets first: the record migration clears the persistence context when it is done.
                recordSetQueryMigration.migrate(ctx.projectId(), dataset.getId(), renames, batchCtx);
                recordRenameMigration.migrate(ctx.projectId(), dataset.getId(), renames, batchCtx);
            }
            if (localizationChanged) {
                migrateLocalization(uuid, confirmDiscard, batchCtx);
            }
        }
        // A field removed or retyped leaves the sets reading it broken: the save stands, the sets are reported.
        return toView(ctx.projectId(), updated)
                .withBrokenRecordSets(recordSetQueryMigration.brokenSets(ctx.projectId(), dataset.getId(), definition));
    }

    /** Whether this save changes which schema fields are {@code localizable} (M24.2.2). */
    private boolean localizableFlagsChanged(Asset dataset, ContentDefinition proposed) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(dataset.getId())
                .map(version -> !com.acme.staticforge.asset.content.LocalizationMigrator
                        .localizableLeaves(compile(version.getPayload().path("contentDefinition").asText("")))
                        .equals(com.acme.staticforge.asset.content.LocalizationMigrator.localizableLeaves(proposed)))
                .orElse(false);
    }

    /**
     * Rewrites every record of the dataset into the shape the new schema declares, inside the
     * caller's open batch. An unconfirmed save that would drop translations throws, rolling the
     * whole save back (M24.2.2).
     */
    private void migrateLocalization(UUID datasetUuid, boolean confirmDiscard, RevisionContext batchCtx) {
        com.acme.staticforge.asset.content.LocalizationContext target =
                com.acme.staticforge.asset.content.LocalizationContext.of(
                        projectLocales.forProject(batchCtx.projectId()));
        com.acme.staticforge.asset.localization.LocalizationMigrationService.MigrationReport report =
                localizationMigrations.migrateTemplate(batchCtx.projectId(), datasetUuid, target, batchCtx, true);
        if (!report.requiresConfirmation() || confirmDiscard) {
            return;
        }
        throw new SfException(com.acme.staticforge.common.Problem.builder()
                .type("https://cms.example.com/problems/sf-api-0409")
                .title("Conflict")
                .status(409)
                .detail("Turning off language dependence would discard " + report.discardedLocaleValues()
                        + " translation(s) in " + report.affectedAssets().size()
                        + " record(s). Re-send with confirmDiscard=true to keep only the default language.")
                .property("code", "SF-API-0409")
                .property("discardedLocaleValues", report.discardedLocaleValues())
                .property("discardedLocales", report.discardedLocales())
                .property("affectedAssets", report.affectedAssets().stream().map(UUID::toString).toList())
                .build());
    }

    @Override
    @Transactional
    public void delete(UUID uuid, RevisionContext ctx) {
        requireDataset(ctx.projectId(), uuid);
        // AssetService owns the record-count guard, so the generic delete path enforces it too.
        assetService.softDelete(uuid, false, ctx);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<DatasetView> find(long projectId, UUID uuid, Long revision) {
        Optional<AssetVersionView> version = revision == null
                ? Optional.of(assetService.requireCurrent(projectId, uuid))
                : assetService.findAt(projectId, uuid, revision);
        return version.filter(v -> v.type() == AssetType.DATASET).map(v -> toView(projectId, v));
    }

    @Override
    @Transactional(readOnly = true)
    public List<DatasetView> list(long projectId) {
        List<DatasetView> views = new ArrayList<>();
        for (AssetVersion version : assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.DATASET)) {
            Asset asset = version.getAsset();
            views.add(toView(projectId, new AssetVersionView(
                    asset.getUuid(), asset.getUid(), asset.getAssetType(), version.getDisplayName(), version.getPayload(),
                    version.getValidFromRevision(), version.isDeleted(), version.getFolderId(), version.getFolderPath(),
                    version.getTemplateAssetId(), version.getChangedBy(), version.getChangedAt())));
        }
        views.sort(Comparator.comparing(DatasetView::displayName, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(DatasetView::uid));
        return views;
    }

    /** {@code ctx} when it already carries a batch, else a new batch revision for this one write. */
    private RevisionContext joinOrBegin(RevisionContext ctx) {
        if (ctx.openRevision() != null) {
            return ctx;
        }
        Revision batch = revisionService.beginBatch(ctx.projectId(), ChangeType.CREATE, ctx.comment(), ctx.userId());
        return RevisionContext.joining(batch, ctx.userId(), ctx.comment());
    }

    // ------------------------------------------------------------------
    // Compile / validate
    // ------------------------------------------------------------------

    /** Compiles a schema with the dataset restrictions; throws before any revision is allocated. */
    private ContentDefinition compile(String source) {
        CdlResult result = cdlCompiler.compile(source);
        List<Diagnostic> diagnostics = new ArrayList<>(result.diagnostics());
        diagnostics.addAll(DatasetCdlRules.check(result.definition()));
        if (diagnostics.stream().anyMatch(d -> d.severity() == Severity.ERROR)) {
            throw new SfException(Problem.builder()
                    .type(PROBLEM_TYPE_422)
                    .title("Validation Failed")
                    .status(422)
                    .detail("CDL has compile errors.")
                    .property("code", "SF-API-0422")
                    .property("diagnostics", diagnostics)
                    .build());
        }
        return result.definition();
    }

    /** A blank title editor means none; otherwise it must be a declared {@code text} editor. */
    private static String validTitleEditor(ContentDefinition definition, String titleEditor) {
        if (titleEditor == null || titleEditor.isBlank()) {
            return null;
        }
        String name = titleEditor.trim();
        boolean text = definition.findEditor(name).map(e -> e.type() == EditorType.TEXT).orElse(false);
        if (!text) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "titleEditor '" + name + "' must name a text editor declared in the schema."));
        }
        return name;
    }

    private ObjectNode payload(String source, ContentDefinition definition, String titleEditor, String description) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("contentDefinition", source == null ? "" : source);
        payload.set("compiledDefinition", objectMapper.valueToTree(definition));
        if (titleEditor == null) {
            payload.putNull("titleEditor");
        } else {
            payload.put("titleEditor", titleEditor);
        }
        payload.put("description", description == null ? "" : description);
        return payload;
    }

    // ------------------------------------------------------------------
    // Lookup
    // ------------------------------------------------------------------

    /** A dataset of this project; another type or project is the same {@code 404} (§8.4). */
    private Asset requireDataset(long projectId, UUID uuid) {
        return assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .filter(asset -> asset.getAssetType() == AssetType.DATASET)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Dataset not found.")));
    }

    private void requireLive(Asset dataset) {
        boolean live = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(dataset.getId())
                .map(version -> !version.isDeleted())
                .orElse(false);
        if (!live) {
            throw new SfException(ProblemFactory.notFound("Dataset not found."));
        }
    }

    private DatasetView toView(long projectId, AssetVersionView view) {
        JsonNode payload = view.payload();
        Long datasetId = assetRepository.findByProjectIdAndUuid(projectId, view.uuid()).map(Asset::getId).orElse(null);
        long recordCount = datasetId == null ? 0 : assetVersionRepository.countCurrentRecordsOfDataset(projectId, datasetId);
        UUID folderUuid = view.folderId() == null
                ? null
                : assetRepository.findById(view.folderId()).map(Asset::getUuid).orElse(null);
        JsonNode titleEditor = payload == null ? null : payload.get("titleEditor");
        return new DatasetView(
                view.uuid(),
                view.uid(),
                view.displayName(),
                folderUuid,
                view.folderPath(),
                payload == null ? "" : payload.path("contentDefinition").asText(""),
                payload == null ? null : payload.path("compiledDefinition"),
                titleEditor == null || !titleEditor.isTextual() ? null : titleEditor.asText(),
                payload == null ? "" : payload.path("description").asText(""),
                recordCount,
                view.validFromRevision(),
                view.deleted(),
                List.of());
    }
}
