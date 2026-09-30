package com.acme.staticforge.asset.globals;

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
import com.acme.staticforge.asset.content.ContentRenameMigrator.EditorRename;
import com.acme.staticforge.asset.content.ContentRenameMigrator;
import com.acme.staticforge.asset.dataset.RecordDatasets;
import com.acme.staticforge.asset.rules.ContentRules;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.cdl.GlobalSetCdlRules;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.rules.RuleScope;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link GlobalSetService} implementation (M17.1.2).
 *
 * <p>Every persisted write routes through {@link AssetService}, so revision allocation,
 * {@code If-Match} optimistic concurrency ({@code 409} with the usual {@code base}/{@code theirs}
 * body), folder-scope enforcement, uid derivation, revision summaries and reference
 * materialization all come from the generic path rather than a second copy here. What this class
 * adds is the property-set-specific part: compiling the CDL, seeding and migrating the values, and
 * validating them against the compiled definition.
 */
@Service
@RevisionAware
public class GlobalSetServiceImpl implements GlobalSetService {

    private static final String PROBLEM_TYPE_422 = "https://cms.example.com/problems/sf-api-0422";

    /** Issue paths are rooted at the payload's {@code content}, exactly as page saves report them. */
    private static final String CONTENT_PATH = "content";

    private final AssetService assetService;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final ObjectMapper objectMapper;
    private final RecordDatasets recordDatasets;
    private final com.acme.staticforge.project.ProjectLocales projectLocales;
    private final ContentRules contentRules;
    private final CdlCompiler cdlCompiler = new CdlCompiler();

    public GlobalSetServiceImpl(
            AssetService assetService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            ObjectMapper objectMapper,
            RecordDatasets recordDatasets,
            com.acme.staticforge.project.ProjectLocales projectLocales,
            ContentRules contentRules) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.objectMapper = objectMapper;
        this.recordDatasets = recordDatasets;
        this.projectLocales = projectLocales;
        this.contentRules = contentRules;
    }

    @Override
    @Transactional
    public GlobalSetView create(CreateGlobalSetCommand cmd, RevisionContext ctx) {
        ContentDefinition definition = compile(cmd.cdl());

        ObjectNode payload = objectMapper.createObjectNode();
        (cmd.cdl() == null ? CdlSources.EMPTY : cmd.cdl()).writeTo(payload);
        payload.set("compiledDefinition", objectMapper.valueToTree(definition));
        payload.set("content", seedDefaults(definition));

        AssetVersionView created = assetService.create(
                new CreateAssetCommand(
                        cmd.projectId(), AssetType.GLOBAL_SET, cmd.displayName(), cmd.parentFolderUuid(), payload, null),
                ctx);
        return toView(created);
    }

    @Override
    @Transactional
    public GlobalSetView updateSchema(UUID uuid, CdlSources cdl, long expectedRevision, RevisionContext ctx) {
        return saveSchema(uuid, cdl, null, expectedRevision, false, ctx);
    }

    @Override
    @Transactional
    public GlobalSetView updateSchema(
            UUID uuid, CdlSources cdl, JsonNode content, long expectedRevision, boolean confirmDiscard, RevisionContext ctx) {
        return saveSchema(uuid, cdl, content, expectedRevision, confirmDiscard, ctx);
    }

    /**
     * The schema save. With {@code content} (M34: the editor's one Save), the values edited against the stored schema
     * are saved first, exactly as {@link #updateValues} would, and then migrated into the new schema with it — one
     * version, one revision.
     */
    private GlobalSetView saveSchema(
            UUID uuid, CdlSources cdl, JsonNode content, long expectedRevision, boolean confirmDiscard, RevisionContext ctx) {
        AssetVersion current = requireOpenSet(ctx.projectId(), uuid);
        ContentDefinition definition = compile(cdl);

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        if (content != null && !content.isNull()) {
            ContentDefinition stored = definitionOf(current.getPayload());
            rejectStructural(recordDatasets.validator(ctx.projectId()).validate(stored, content, null, CONTENT_PATH));
            payload.set("content", contentRules.saveContent(ctx.projectId(), uuid, AssetType.GLOBAL_SET, stored,
                    current.getPayload(), current.getPayload().get("content"), content));
        }
        (cdl == null ? CdlSources.EMPTY : cdl).writeTo(payload);
        payload.set("compiledDefinition", objectMapper.valueToTree(definition));

        // The schema change and the value migration it causes are the same asset, so they are the
        // same version write and therefore the same revision — no cross-asset cascade (§12.3 only
        // needs one because a section template's renames fan out into every page using it).
        ObjectNode migrated = contentOf(payload);
        List<EditorRename> renames = ContentRenameMigrator.collect(definition);
        ContentRenameMigrator.apply(migrated, renames);
        ContentRenameMigrator.pruneUnknown(migrated, definition);
        migrateLocalization(ctx.projectId(), migrated, definition, confirmDiscard);
        payload.set("content", migrated);

        rejectStructural(recordDatasets.validator(ctx.projectId()).validate(definition, migrated, null, CONTENT_PATH));

        return toView(assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx));
    }

    @Override
    @Transactional
    public GlobalSetView updateValues(UUID uuid, JsonNode content, long expectedRevision, RevisionContext ctx) {
        AssetVersion current = requireOpenSet(ctx.projectId(), uuid);
        ContentDefinition definition = definitionOf(current.getPayload());

        rejectStructural(recordDatasets.validator(ctx.projectId()).validate(definition, content, null, CONTENT_PATH));

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        JsonNode incoming = content == null || content.isNull() ? objectMapper.createObjectNode() : content;
        payload.set("content", contentRules.saveContent(ctx.projectId(), uuid, AssetType.GLOBAL_SET, definition,
                current.getPayload(), current.getPayload().get("content"), incoming));

        return toView(assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx));
    }

    @Override
    @Transactional(readOnly = true)
    public List<ContentIssue> contentIssues(long projectId, GlobalSetView view) {
        ContentDefinition definition = cdlCompiler.compile(view.cdl())
                .definition();
        if (definition == null) {
            return List.of();
        }
        ObjectNode payload = objectMapper.createObjectNode();
        JsonNode content = view.content() == null || !view.content().isObject() ? objectMapper.createObjectNode() : view.content();
        payload.set("content", content);
        return contentRules.content(projectId, view.uuid(), AssetType.GLOBAL_SET, definition, payload, content,
                RuleScope.EDIT, null).findings();
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<GlobalSetView> find(long projectId, UUID uuid, Long revision) {
        Optional<AssetVersionView> version = revision == null
                ? Optional.of(assetService.requireCurrent(projectId, uuid))
                : assetService.findAt(projectId, uuid, revision);
        return version.filter(v -> v.type() == AssetType.GLOBAL_SET).map(GlobalSetServiceImpl::toView);
    }

    @Override
    @Transactional(readOnly = true)
    public List<GlobalSetView> list(long projectId, UUID folderUuid) {
        Long folderId = folderUuid == null ? null : assetRepository.findByProjectIdAndUuid(projectId, folderUuid)
                .map(Asset::getId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Folder not found.")));

        List<GlobalSetView> views = new ArrayList<>();
        for (AssetVersion version : assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.GLOBAL_SET)) {
            if (folderId != null && !folderId.equals(version.getFolderId())) {
                continue;
            }
            Asset asset = assetRepository.findById(version.getAssetId())
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")));
            views.add(new GlobalSetView(
                    asset.getUuid(),
                    asset.getUid(),
                    version.getDisplayName(),
                    version.getFolderPath(),
                    CdlSources.of(version.getPayload()),
                    version.getPayload().path("compiledDefinition"),
                    version.getPayload().path("content"),
                    version.getValidFromRevision(),
                    version.isDeleted()));
        }
        views.sort((a, b) -> a.displayName().compareToIgnoreCase(b.displayName()));
        return views;
    }

    // ------------------------------------------------------------------
    // Compile / validate
    // ------------------------------------------------------------------

    /**
     * Compiles a set's CDL, applying the property-set restrictions on top of the language rules.
     * Throws before any revision is allocated, so invalid CDL never leaves a gap in the counter.
     */
    private ContentDefinition compile(CdlSources source) {
        CdlResult result = cdlCompiler.compile(source);
        List<Diagnostic> diagnostics = new ArrayList<>(result.diagnostics());
        GlobalSetCdlRules.check(result.definition()).forEach(d -> diagnostics.add(d.inField(CdlSources.CONTENT)));
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

    /**
     * Rejects a save whose values are malformed for their editors. Completeness findings (an empty
     * required field, a count out of bounds) are deliberately allowed through and surface at
     * publish time instead, exactly as for a page (§10.5).
     */
    private static void rejectStructural(List<ContentIssue> issues) {
        List<ContentIssue> structural = issues.stream()
                .filter(issue -> issue.kind() == ContentIssue.Kind.STRUCTURAL)
                .toList();
        if (structural.isEmpty()) {
            return;
        }
        ContentIssue first = structural.get(0);
        String detail = "Property set values are invalid: " + first.path() + " — " + first.message()
                + (structural.size() > 1 ? " (+" + (structural.size() - 1) + " more)" : "");
        throw new SfException(ProblemFactory.unprocessableEntity(detail, "issues", structural));
    }

    /** The values a freshly created set starts with: every editor that declares a `defaultValue`. */
    private ObjectNode seedDefaults(ContentDefinition definition) {
        ObjectNode content = objectMapper.createObjectNode();
        seedInto(definition.editors(), content);
        return content;
    }

    private static void seedInto(List<EditorDefinition> editors, ObjectNode content) {
        for (EditorDefinition editor : editors) {
            JsonNode value = editor.defaultValue();
            if (value != null && !value.isMissingNode() && !value.isNull()) {
                content.set(editor.name(), value);
            }
            if (editor.isGroup()) {
                // Groups are transparent: their children share the enclosing namespace.
                seedInto(editor.items(), content);
            }
        }
    }

    private ContentDefinition definitionOf(JsonNode payload) {
        return cdlCompiler.compile(CdlSources.of(payload)).definition();
    }

    private ObjectNode contentOf(JsonNode payload) {
        JsonNode content = payload.path("content");
        return content.isObject() ? (ObjectNode) content.deepCopy() : objectMapper.createObjectNode();
    }

    // ------------------------------------------------------------------
    // Lookup
    // ------------------------------------------------------------------

    /**
     * The open version of a live set in this project. A uuid belonging to another project, to
     * another asset type or to a deleted set is reported as {@code 404} — never {@code 403} —
     * so the API leaks no existence information across projects (§8.4).
     */
    private AssetVersion requireOpenSet(long projectId, UUID uuid) {
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .filter(a -> a.getAssetType() == AssetType.GLOBAL_SET)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Property set not found.")));
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                .filter(version -> !version.isDeleted())
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Property set not found.")));
    }

    private static GlobalSetView toView(AssetVersionView view) {
        JsonNode payload = view.payload();
        return new GlobalSetView(
                view.uuid(),
                view.uid(),
                view.displayName(),
                view.folderPath(),
                CdlSources.of(payload),
                payload == null ? null : payload.path("compiledDefinition"),
                payload == null ? null : payload.path("content"),
                view.validFromRevision(),
                view.deleted());
    }

    /**
     * Brings the set's own values into the shape its new schema declares (M24.2.2). A property set
     * owns its schema and its values, so this is the same version write — no cross-asset cascade.
     * Dropping translations needs the caller's confirmation.
     */
    private void migrateLocalization(
            long projectId,
            com.fasterxml.jackson.databind.node.ObjectNode content,
            ContentDefinition definition,
            boolean confirmDiscard) {
        com.acme.staticforge.asset.content.LocalizationContext target =
                com.acme.staticforge.asset.content.LocalizationContext.of(projectLocales.forProject(projectId));
        com.acme.staticforge.asset.content.LocalizationMigrator.Plan preview =
                com.acme.staticforge.asset.content.LocalizationMigrator.preview(content, definition, target);
        if (preview.requiresConfirmation() && !confirmDiscard) {
            throw new SfException(com.acme.staticforge.common.Problem.builder()
                    .type("https://cms.example.com/problems/sf-api-0409")
                    .title("Conflict")
                    .status(409)
                    .detail("Turning off language dependence would discard translations of "
                            + preview.discards().size() + " value(s). Re-send with confirmDiscard=true "
                            + "to keep only the default language.")
                    .property("code", "SF-API-0409")
                    .property("discardedLocaleValues",
                            preview.discards().stream().mapToInt(d -> d.locales().size()).sum())
                    .property("discardedValues", preview.discards().stream().map(d -> d.path()).toList())
                    .build());
        }
        com.acme.staticforge.asset.content.LocalizationMigrator.normalize(content, definition, target, true);
    }
}
