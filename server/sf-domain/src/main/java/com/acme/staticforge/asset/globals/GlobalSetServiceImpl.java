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
import com.acme.staticforge.asset.content.ContentRenameMigrator;
import com.acme.staticforge.asset.content.ContentRenameMigrator.EditorRename;
import com.acme.staticforge.asset.content.ContentValidator;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.cdl.GlobalSetCdlRules;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.Severity;
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

    private final AssetService assetService;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final ObjectMapper objectMapper;
    private final CdlCompiler cdlCompiler = new CdlCompiler();
    private final ContentValidator contentValidator = new ContentValidator();

    public GlobalSetServiceImpl(
            AssetService assetService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            ObjectMapper objectMapper) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public GlobalSetView create(CreateGlobalSetCommand cmd, RevisionContext ctx) {
        ContentDefinition definition = compile(cmd.contentDefinition());

        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("contentDefinition", cmd.contentDefinition() == null ? "" : cmd.contentDefinition());
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
    public GlobalSetView updateSchema(
            UUID uuid, String contentDefinition, long expectedRevision, RevisionContext ctx) {
        AssetVersion current = requireOpenSet(ctx.projectId(), uuid);
        ContentDefinition definition = compile(contentDefinition);

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        payload.put("contentDefinition", contentDefinition == null ? "" : contentDefinition);
        payload.set("compiledDefinition", objectMapper.valueToTree(definition));

        // The schema change and the value migration it causes are the same asset, so they are the
        // same version write and therefore the same revision — no cross-asset cascade (§12.3 only
        // needs one because a section template's renames fan out into every page using it).
        ObjectNode content = contentOf(payload);
        List<EditorRename> renames = ContentRenameMigrator.collect(definition);
        ContentRenameMigrator.apply(content, renames);
        ContentRenameMigrator.pruneUnknown(content, definition);
        payload.set("content", content);

        rejectStructural(contentValidator.validate(definition, content));

        return toView(assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx));
    }

    @Override
    @Transactional
    public GlobalSetView updateValues(UUID uuid, JsonNode content, long expectedRevision, RevisionContext ctx) {
        AssetVersion current = requireOpenSet(ctx.projectId(), uuid);
        ContentDefinition definition = definitionOf(current.getPayload());

        rejectStructural(contentValidator.validate(definition, content));

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        payload.set("content", content == null || content.isNull() ? objectMapper.createObjectNode() : content);

        return toView(assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx));
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
                    version.getPayload().path("contentDefinition").asText(""),
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
    private ContentDefinition compile(String source) {
        CdlResult result = cdlCompiler.compile(source);
        List<Diagnostic> diagnostics = new ArrayList<>(result.diagnostics());
        diagnostics.addAll(GlobalSetCdlRules.check(result.definition()));
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
        return cdlCompiler.compile(payload.path("contentDefinition").asText("")).definition();
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
                payload == null ? "" : payload.path("contentDefinition").asText(""),
                payload == null ? null : payload.path("compiledDefinition"),
                payload == null ? null : payload.path("content"),
                view.validFromRevision(),
                view.deleted());
    }
}
