package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetQuery;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.content.BodyDefinition;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link TemplateService} implementation. Owns the compile-on-save pipeline: the CDL is
 * compiled into a {@link ContentDefinition} and each channel's OCTL into a
 * {@link com.acme.staticforge.template.octl.CompiledTemplate} against that definition plus a
 * project-scoped {@link ReferenceResolver}. Persisted writes route through
 * {@link AssetService} so revisioning stays intact; the CDL-change content migration is the
 * one exception, where every affected page is rewritten within a single allocated revision.
 */
@Service
@RevisionAware
public class TemplateServiceImpl implements TemplateService {

    private static final String PROBLEM_TYPE_422 = "https://cms.example.com/problems/sf-api-0422";

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetService assetService;
    private final RevisionService revisionService;
    private final ObjectMapper objectMapper;
    private final CdlCompiler cdlCompiler = new CdlCompiler();
    private final OctlCompiler octlCompiler = new OctlCompiler();

    public TemplateServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetService assetService,
            RevisionService revisionService,
            ObjectMapper objectMapper) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetService = assetService;
        this.revisionService = revisionService;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public TemplateView create(CreateTemplateCommand cmd, RevisionContext ctx) {
        requireKind(cmd.kind());
        ensureFoldersAndMigrate(cmd.projectId(), ctx);
        UUID parentFolderUuid = resolveTemplateParentFolder(cmd, ctx);

        ContentDefinition definition = compileDefinition(cmd.contentDefinition());
        ObjectNode payload = buildPayload(
                cmd.projectId(), cmd.kind(), cmd.contentDefinition(), cmd.channelSources(),
                cmd.category(), cmd.deprecated(), cmd.outputPath(), definition);

        AssetVersionView created = assetService.create(
                new CreateAssetCommand(cmd.projectId(), cmd.kind(), cmd.displayName(), parentFolderUuid, payload, null), ctx);
        return toView(created);
    }

    /**
     * Resolves the folder a new template lands in (spec M13.1.3): an explicit {@code
     * parentFolderUuid} is used as-is (after a defense-in-depth {@code templateKind} check — the
     * cross-store case is already covered generically by {@code AssetServiceImpl.validateFolderScope}
     * once {@code FolderScope.requiredFor} maps both template asset types to {@code TEMPLATES});
     * {@code null} resolves to the project's fixed folder matching {@code cmd.kind()}, lazily
     * provisioning it via {@link AssetService#ensureTemplateFolders} if needed — so template
     * creation never has to special-case a missing parent.
     */
    private UUID resolveTemplateParentFolder(CreateTemplateCommand cmd, RevisionContext ctx) {
        UUID parentFolderUuid = cmd.parentFolderUuid();
        if (parentFolderUuid == null) {
            return assetService.ensureTemplateFolders(cmd.projectId(), ctx).get(cmd.kind()).uuid();
        }

        Asset folder = assetRepository.findByProjectIdAndUuid(cmd.projectId(), parentFolderUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Parent folder not found.")));
        if (folder.getAssetType() == AssetType.FOLDER) {
            AssetVersion version = requireOpen(folder.getId());
            AssetType actualKind = FolderScope.templateKindFromPayload(version.getPayload());
            if (actualKind != null && actualKind != cmd.kind()) {
                throw new SfException(ProblemFactory.unprocessableEntity(
                        "This folder is for " + actualKind.name().toLowerCase(Locale.ROOT)
                                + " templates — " + cmd.kind().name().toLowerCase(Locale.ROOT) + "s can't be placed here."));
            }
        }
        return parentFolderUuid;
    }

    @Override
    @Transactional
    public TemplateView update(UUID uuid, UpdateTemplateCommand cmd, long expectedRevision, RevisionContext ctx) {
        Asset template = requireTemplate(ctx.projectId(), uuid);
        ContentDefinition definition = compileDefinition(cmd.contentDefinition());
        ObjectNode payload = buildPayload(
                template.getProjectId(), template.getAssetType(), cmd.contentDefinition(), cmd.channelSources(),
                cmd.category(), cmd.deprecated(), cmd.outputPath(), definition);

        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(cmd.displayName(), payload), expectedRevision, ctx);

        if (template.getAssetType() == AssetType.SECTION_TEMPLATE) {
            migrateRenames(template, definition, ctx);
        }
        return toView(updated);
    }

    @Override
    @Transactional
    public TemplateView saveChannel(UUID uuid, String channelKey, String octlSource, long expectedRevision, RevisionContext ctx) {
        Asset template = requireTemplate(ctx.projectId(), uuid);
        AssetVersion current = requireOpen(template.getId());

        ContentDefinition definition = compileDefinition(current.getPayload().path("contentDefinition").asText(""));
        OctlResult result = compileChannel(template.getProjectId(), octlSource, channelKey, definition);

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        ObjectNode channel = payload.withObject("channelTemplates").withObject(channelKey);
        channel.put("source", octlSource);
        channel.put("compiledHash", result.template().hash());

        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx);
        return toView(updated);
    }

    @Override
    @Transactional
    public TemplateView deleteChannel(UUID uuid, String channelKey, long expectedRevision, RevisionContext ctx) {
        Asset template = requireTemplate(ctx.projectId(), uuid);
        AssetVersion current = requireOpen(template.getId());

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        payload.withObject("channelTemplates").remove(channelKey);

        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx);
        return toView(updated);
    }

    @Override
    @Transactional(readOnly = true)
    public TemplateView get(long projectId, UUID uuid) {
        return toView(assetService.requireCurrent(projectId, uuid));
    }

    @Override
    @Transactional
    public Page<AssetSummary> list(long projectId, AssetType kind, Pageable pageable, RevisionContext ctx) {
        ensureFoldersAndMigrate(projectId, ctx);
        return assetService.search(new AssetQuery(projectId, kind, null, null), pageable);
    }

    @Override
    @Transactional
    public void delete(UUID uuid, RevisionContext ctx) {
        requireTemplate(ctx.projectId(), uuid);
        assetService.softDelete(uuid, false, ctx);
    }

    // ------------------------------------------------------------------
    // Compile-on-save
    // ------------------------------------------------------------------

    private ContentDefinition compileDefinition(String source) {
        CdlResult result = cdlCompiler.compile(source);
        if (result.hasErrors()) {
            throw diagnosticsError("CDL", result.diagnostics());
        }
        return result.definition();
    }

    private OctlResult compileChannel(long projectId, String source, String channelKey, ContentDefinition definition) {
        OctlResult result = octlCompiler.compile(source, channelKey, referenceResolver(projectId), definition);
        if (result.hasErrors()) {
            throw diagnosticsError("OCTL", result.diagnostics());
        }
        return result;
    }

    private ReferenceResolver referenceResolver(long projectId) {
        return (assetType, uid) -> {
            AssetType type = assetTypeForRef(assetType);
            if (type == null) {
                return Optional.empty();
            }
            return assetRepository.findByProjectIdAndAssetTypeAndUid(projectId, type, uid).map(Asset::getUuid);
        };
    }

    /**
     * A navigation folder is plain {@code AssetType.FOLDER} under the hood (`M8.1.2`) — there is
     * no {@code AssetType.NAV} — so a {@code nav:uid} reference needs this one special-case before
     * falling back to {@code AssetType.valueOf(...)}, mirroring {@code GenerationRenderer}'s and
     * {@code PageRenderService}'s identical helper. Without it, {@code $CMS_NAVIGATION(nav:uid)$}
     * always failed compile-on-save validation with a false {@code SF-TPL-0110}, even against a
     * real {@code FOLDER} asset with that uid.
     */
    private static AssetType assetTypeForRef(String assetType) {
        if ("nav".equals(assetType)) {
            return AssetType.FOLDER;
        }
        try {
            return AssetType.valueOf(assetType.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException | NullPointerException e) {
            return null;
        }
    }

    private ObjectNode buildPayload(
            long projectId,
            AssetType kind,
            String contentDefinition,
            Map<String, String> channelSources,
            String category,
            boolean deprecated,
            Map<String, String> outputPath,
            ContentDefinition definition) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("contentDefinition", contentDefinition == null ? "" : contentDefinition);
        payload.set("compiledDefinition", objectMapper.valueToTree(definition));

        ObjectNode channelTemplates = payload.putObject("channelTemplates");
        for (Map.Entry<String, String> entry : channelSources.entrySet()) {
            OctlResult result = compileChannel(projectId, entry.getValue(), entry.getKey(), definition);
            ObjectNode channel = channelTemplates.putObject(entry.getKey());
            channel.put("source", entry.getValue());
            channel.put("compiledHash", result.template().hash());
        }

        payload.put("category", category == null ? "" : category);

        if (kind == AssetType.SECTION_TEMPLATE) {
            payload.put("deprecated", deprecated);
        } else {
            ArrayNode bodies = payload.putArray("bodies");
            for (BodyDefinition body : definition.bodies()) {
                ObjectNode node = bodies.addObject();
                node.put("name", body.name());
                node.put("label", body.label());
                ArrayNode allow = node.putArray("allow");
                body.allow().forEach(allow::add);
                if (body.min() != null) {
                    node.put("min", body.min());
                } else {
                    node.putNull("min");
                }
                if (body.max() != null) {
                    node.put("max", body.max());
                } else {
                    node.putNull("max");
                }
            }

            ObjectNode output = payload.putObject("outputPath");
            outputPath.forEach(output::put);
        }
        return payload;
    }

    private SfException diagnosticsError(String what, List<Diagnostic> diagnostics) {
        Problem problem = Problem.builder()
                .type(PROBLEM_TYPE_422)
                .title("Validation Failed")
                .status(422)
                .detail(what + " has compile errors.")
                .property("code", "SF-API-0422")
                .property("diagnostics", diagnostics)
                .build();
        return new SfException(problem);
    }

    // ------------------------------------------------------------------
    // CDL-change content migration (§12.3)
    // ------------------------------------------------------------------

    private void migrateRenames(Asset template, ContentDefinition definition, RevisionContext ctx) {
        List<EditorRename> renames = collectRenames(definition);
        if (renames.isEmpty()) {
            return;
        }

        String templateUuid = template.getUuid().toString();
        List<AffectedPage> affected = new ArrayList<>();
        for (AssetVersion page : assetVersionRepository.findCurrentByProjectAndType(ctx.projectId(), AssetType.PAGE)) {
            ObjectNode migrated = migratePagePayload(page.getPayload(), templateUuid, renames);
            if (migrated != null) {
                affected.add(new AffectedPage(page, migrated));
            }
        }
        if (affected.isEmpty()) {
            return;
        }

        // One editor rename can affect several pages at once — open a single batch for the
        // whole cascade (spec §7.1) rather than one revision per page, on the shared
        // beginBatch/allocateOrJoin mechanism (M15.1) instead of a bespoke inline duplicate.
        Revision batch = revisionService.beginBatch(ctx.projectId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        RevisionContext batchCtx = RevisionContext.joining(batch, ctx.userId(), ctx.comment());
        for (AffectedPage page : affected) {
            Revision revision = revisionService.allocateOrJoin(batchCtx, ChangeType.UPDATE);
            close(page.version().getAssetId(), revision.getRevisionId());
            insertVersion(page.version(), page.payload(), revision.getRevisionId(), ctx.userId());
            Asset asset = assetRepository.findById(page.version().getAssetId())
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Page not found.")));
            appendSummary(asset, revision);
        }
    }

    private List<EditorRename> collectRenames(ContentDefinition definition) {
        List<EditorRename> renames = new ArrayList<>();
        for (EditorDefinition editor : definition.editors()) {
            String from = editor.renamedFrom();
            if (from != null && !from.isBlank() && !from.equals(editor.name())) {
                renames.add(new EditorRename(from, editor.name()));
            }
        }
        return renames;
    }

    private ObjectNode migratePagePayload(JsonNode payload, String templateUuid, List<EditorRename> renames) {
        JsonNode bodies = payload.get("bodies");
        if (bodies == null || !bodies.isObject()) {
            return null;
        }

        ObjectNode copy = (ObjectNode) payload.deepCopy();
        boolean changed = false;
        Iterator<Map.Entry<String, JsonNode>> bodyFields = copy.get("bodies").fields();
        while (bodyFields.hasNext()) {
            JsonNode sections = bodyFields.next().getValue();
            if (sections == null || !sections.isArray()) {
                continue;
            }
            for (JsonNode section : sections) {
                if (!templateUuid.equals(section.path("templateRef").asText())) {
                    continue;
                }
                JsonNode contentNode = section.get("content");
                if (contentNode == null || !contentNode.isObject()) {
                    continue;
                }
                ObjectNode content = (ObjectNode) contentNode;
                for (EditorRename rename : renames) {
                    if (content.has(rename.from())) {
                        content.set(rename.to(), content.get(rename.from()));
                        content.remove(rename.from());
                        changed = true;
                    }
                }
            }
        }
        return changed ? copy : null;
    }

    private void close(Long assetId, long revisionId) {
        assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).ifPresent(version -> {
            version.setValidToRevision(revisionId);
            assetVersionRepository.save(version);
        });
    }

    private void insertVersion(AssetVersion current, JsonNode payload, long revisionId, Long changedBy) {
        insertVersion(current, payload, revisionId, changedBy, current.getFolderId(), current.getFolderPath(), null);
    }

    /**
     * {@code asset}, when non-null, is wired directly onto the new row (see {@link
     * AssetVersion#setAsset}) — required whenever the caller's own transaction might read the
     * new version back out through a JPQL query joining {@code v.asset} (e.g. {@code
     * AssetServiceImpl#search}), since the session's identity map would otherwise keep handing
     * back this very instance with a still-null association.
     */
    private void insertVersion(
            AssetVersion current, JsonNode payload, long revisionId, Long changedBy, Long folderId, String folderPath, Asset asset) {
        AssetVersion next = new AssetVersion(
                current.getAssetId(), revisionId, current.getDisplayName(), payload, changedBy, Instant.now());
        next.setFolderId(folderId);
        next.setFolderPath(folderPath);
        next.setTemplateAssetId(current.getTemplateAssetId());
        next.setDeleted(current.isDeleted());
        if (asset != null) {
            next.setAsset(asset);
        }
        assetVersionRepository.save(next);
    }

    private void appendSummary(Asset asset, Revision revision) {
        revisionService.appendSummary(
                asset.getProjectId(),
                revision.getRevisionId(),
                AssetChange.create(asset.getUuid().toString(), asset.getAssetType().name(), "UPDATE", List.of("bodies")));
    }

    private void appendMoveSummary(Asset asset, Revision revision) {
        revisionService.appendSummary(
                asset.getProjectId(),
                revision.getRevisionId(),
                AssetChange.create(asset.getUuid().toString(), asset.getAssetType().name(), "MOVE", List.of("folder")));
    }

    // ------------------------------------------------------------------
    // Reparent pre-M13 templates into the fixed folders (§M13.1.4)
    // ------------------------------------------------------------------

    /**
     * Lazily and idempotently reparents every current {@code PAGE_TEMPLATE}/{@code
     * SECTION_TEMPLATE} not already under a {@code TEMPLATES}-scope folder into this project's
     * fixed folder matching its kind, all in one compound {@code MOVE} batch revision (spec
     * §7.1) — one revision for the whole migration run, not one per template. Self-heals on first
     * relevant access (invoked from {@link #create} and {@link #list}), mirroring {@code
     * AssetServiceImpl.ensureRootFolder}'s lazy-create-on-first-access pattern. No-op once every
     * current template is already correctly placed.
     */
    private void ensureFoldersAndMigrate(long projectId, RevisionContext ctx) {
        Map<AssetType, AssetVersionView> folders = assetService.ensureTemplateFolders(projectId, ctx);

        List<AssetVersion> toMove = new ArrayList<>();
        for (AssetType kind : List.of(AssetType.PAGE_TEMPLATE, AssetType.SECTION_TEMPLATE)) {
            for (AssetVersion version : assetVersionRepository.findCurrentByProjectAndType(projectId, kind)) {
                if (!isUnderTemplatesFolder(version)) {
                    toMove.add(version);
                }
            }
        }
        if (toMove.isEmpty()) {
            return;
        }

        // "Migrate every pre-M13 template into its fixed folder" is one logical maintenance
        // operation — open a single batch for the whole run rather than one revision per
        // template, on the shared beginBatch/allocateOrJoin mechanism (M15.1).
        Revision batch = revisionService.beginBatch(projectId, ChangeType.MOVE, ctx.comment(), ctx.userId());
        RevisionContext batchCtx = RevisionContext.joining(batch, ctx.userId(), ctx.comment());
        for (AssetVersion version : toMove) {
            Asset asset = assetRepository.findById(version.getAssetId())
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Template not found.")));
            AssetVersionView targetFolder = folders.get(asset.getAssetType());
            Asset targetFolderAsset = assetRepository.findByProjectIdAndUuid(projectId, targetFolder.uuid())
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Fixed template folder not found.")));

            Revision revision = revisionService.allocateOrJoin(batchCtx, ChangeType.MOVE);
            close(version.getAssetId(), revision.getRevisionId());
            insertVersion(
                    version, version.getPayload(), revision.getRevisionId(), ctx.userId(),
                    targetFolderAsset.getId(), targetFolder.folderPath(), asset);
            appendMoveSummary(asset, revision);
        }
    }

    /** True when {@code version} already sits directly in a {@code TEMPLATES}-scope folder. */
    private boolean isUnderTemplatesFolder(AssetVersion version) {
        if (version.getFolderId() == null) {
            return false;
        }
        Asset folder = assetRepository.findById(version.getFolderId()).orElse(null);
        if (folder == null || folder.getAssetType() != AssetType.FOLDER) {
            return false;
        }
        AssetVersion folderVersion = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(folder.getId()).orElse(null);
        return folderVersion != null && FolderScope.fromPayload(folderVersion.getPayload()) == FolderScope.TEMPLATES;
    }

    // ------------------------------------------------------------------
    // Lookups + guards
    // ------------------------------------------------------------------

    private static void requireKind(AssetType kind) {
        if (kind != AssetType.SECTION_TEMPLATE && kind != AssetType.PAGE_TEMPLATE) {
            throw new SfException(ProblemFactory.unprocessableEntity("Unknown template kind."));
        }
    }

    private Asset requireTemplate(long projectId, UUID uuid) {
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Template not found.")));
        if (asset.getAssetType() != AssetType.SECTION_TEMPLATE && asset.getAssetType() != AssetType.PAGE_TEMPLATE) {
            throw new SfException(ProblemFactory.unprocessableEntity("Asset is not a template."));
        }
        return asset;
    }

    private AssetVersion requireOpen(Long assetId) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Template has no current version.")));
    }

    private TemplateView toView(AssetVersionView view) {
        UUID folderUuid = view.folderId() == null ? null : folderUuid(view.folderId());
        return new TemplateView(
                view.uuid(), view.uid(), view.type(), view.displayName(), view.payload(),
                view.validFromRevision(), view.deleted(), folderUuid, view.folderPath());
    }

    private UUID folderUuid(Long folderId) {
        return assetRepository.findById(folderId).map(Asset::getUuid).orElse(null);
    }

    private record EditorRename(String from, String to) {}

    private record AffectedPage(AssetVersion version, ObjectNode payload) {}
}
