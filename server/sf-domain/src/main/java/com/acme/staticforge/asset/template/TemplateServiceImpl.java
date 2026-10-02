package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetQuery;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.content.ContentRenameMigrator;
import com.acme.staticforge.asset.content.ContentRenameMigrator.EditorRename;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.reference.ProjectReferenceResolver;
import com.acme.staticforge.asset.content.LocalizationContext;
import com.acme.staticforge.asset.content.LocalizationMigrator;
import com.acme.staticforge.asset.localization.LocalizationMigrationService;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
import com.acme.staticforge.project.ProjectLocales;
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
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.cdl.PaginationCdlRules;
import com.acme.staticforge.template.cdl.TemplateRuleCdlRules;
import com.acme.staticforge.template.content.BodyDefinition;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.ChainCompileMemo;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlNode;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
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
 *
 * <p>Page templates inherit (M20): each channel compiles against its {@code $CMS_EXTENDS} chain from the
 * project's live {@link TemplateHierarchy}, {@code parentTemplateRef} is derived from the channels, and a save of a
 * template with descendants first recompiles every descendant against the proposed version, rejecting the save
 * when one would break.
 */
@Service
@RevisionAware
public class TemplateServiceImpl implements TemplateService {

    private static final String PROBLEM_TYPE_422 = "https://cms.example.com/problems/sf-api-0422";

    /** The source path of a page template's {@code TEMPLATE} edge to its parent (M20.2.2). */
    public static final String PARENT_SOURCE_PATH = "parentTemplateRef";

    /** The page template payload's per-channel path patterns of pages 2..N of a paginated page (M21.2.1). */
    public static final String PAGINATION_PATH = "paginationPath";

    /** How many page uids a "template in use" problem lists. */
    private static final int LISTED_PAGES = 10;

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetReferenceRepository assetReferenceRepository;
    private final AssetService assetService;
    private final RevisionService revisionService;
    private final ObjectMapper objectMapper;
    private final ReferenceMaterializer referenceMaterializer;
    private final ProjectReferenceResolver projectReferences;
    private final TemplateHierarchies hierarchies;
    private final ProjectLocales projectLocales;
    private final LocalizationMigrationService localizationMigrations;
    private final CdlCompiler cdlCompiler = new CdlCompiler();
    private final OctlCompiler octlCompiler = new OctlCompiler();

    public TemplateServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetReferenceRepository assetReferenceRepository,
            AssetService assetService,
            RevisionService revisionService,
            ObjectMapper objectMapper,
            ReferenceMaterializer referenceMaterializer,
            ProjectReferenceResolver projectReferences,
            TemplateHierarchies hierarchies,
            ProjectLocales projectLocales,
            LocalizationMigrationService localizationMigrations) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetReferenceRepository = assetReferenceRepository;
        this.assetService = assetService;
        this.revisionService = revisionService;
        this.objectMapper = objectMapper;
        this.referenceMaterializer = referenceMaterializer;
        this.projectReferences = projectReferences;
        this.hierarchies = hierarchies;
        this.projectLocales = projectLocales;
        this.localizationMigrations = localizationMigrations;
    }

    @Override
    @Transactional
    public TemplateView create(CreateTemplateCommand cmd, RevisionContext ctx) {
        requireKind(cmd.kind());
        ensureFoldersAndMigrate(cmd.projectId(), ctx);
        UUID parentFolderUuid = resolveTemplateParentFolder(cmd, ctx);

        ContentDefinition definition = compileDefinition(cmd.cdl(), cmd.kind());
        CompiledChannels compiled = compileChannels(
                cmd.projectId(), cmd.kind(), null, null, cmd.channelSources(), cmd.channelSources().keySet(), definition,
                hierarchies.live(cmd.projectId()));
        ObjectNode payload = buildPayload(
                cmd.kind(), cmd.cdl(), compiled, cmd.category(), cmd.deprecated(), cmd.outputPath(), definition,
                cmd.abstractTemplate(), cmd.paginationPath());

        AssetVersionView created = assetService.create(
                new CreateAssetCommand(cmd.projectId(), cmd.kind(), cmd.displayName(), parentFolderUuid, payload, null), ctx);
        return toView(cmd.projectId(), created, List.of());
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
        return update(uuid, cmd, expectedRevision, false, ctx);
    }

    @Override
    @Transactional
    public TemplateView update(
            UUID uuid, UpdateTemplateCommand cmd, long expectedRevision, boolean confirmDiscard, RevisionContext ctx) {
        Asset template = requireTemplate(ctx.projectId(), uuid);
        ContentDefinition definition = compileDefinition(cmd.cdl(), template.getAssetType());
        boolean localizationChanged = localizableFlagsChanged(template, definition);
        CompiledChannels compiled = compileChannels(
                template.getProjectId(), template.getAssetType(), uuid, template.getUid(), cmd.channelSources(),
                cmd.channelSources().keySet(), definition, hierarchies.live(template.getProjectId()));
        ObjectNode payload = buildPayload(
                template.getAssetType(), cmd.cdl(), compiled, cmd.category(), cmd.deprecated(), cmd.outputPath(),
                definition, cmd.abstractTemplate(), cmd.paginationPath());

        if (template.getAssetType() == AssetType.SECTION_TEMPLATE) {
            if (localizationChanged) {
                // The CDL change and the section values it rewrites are one logical change (§7.1).
                Revision batch = revisionService.beginBatch(
                        ctx.projectId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
                RevisionContext batchCtx = RevisionContext.joining(batch, ctx.userId(), ctx.comment());
                AssetVersionView updated = assetService.update(
                        uuid, new UpdateAssetCommand(cmd.displayName(), payload), expectedRevision, batchCtx);
                migrateRenames(template, definition, batchCtx);
                migrateLocalization(uuid, confirmDiscard, batchCtx);
                return toView(ctx.projectId(), updated, List.of());
            }
            AssetVersionView updated = assetService.update(
                    uuid, new UpdateAssetCommand(cmd.displayName(), payload), expectedRevision, ctx);
            migrateRenames(template, definition, ctx);
            return toView(ctx.projectId(), updated, List.of());
        }

        if (cmd.abstractTemplate()) {
            requireNotUsedByPages(template);
        }
        List<Asset> descendants = descendants(template);
        List<DescendantIssue> warnings = validateDescendants(template, payload, definition, descendants);
        List<EditorRename> renames = ContentRenameMigrator.collect(definition);
        if (renames.isEmpty() && !localizationChanged) {
            AssetVersionView updated = assetService.update(
                    uuid, new UpdateAssetCommand(cmd.displayName(), payload), expectedRevision, ctx);
            return toView(ctx.projectId(), updated, warnings);
        }

        // The layout change and the page content it migrates are one logical change: one revision listing the
        // template and every rewritten page of it and of every descendant (§12.3, M15, M20.2.2).
        Revision batch = revisionService.beginBatch(ctx.projectId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        RevisionContext batchCtx = RevisionContext.joining(batch, ctx.userId(), ctx.comment());
        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(cmd.displayName(), payload), expectedRevision, batchCtx);
        List<Long> templateIds = new ArrayList<>();
        templateIds.add(template.getId());
        descendants.forEach(descendant -> templateIds.add(descendant.getId()));
        if (!renames.isEmpty()) {
            migratePageContent(ctx.projectId(), templateIds, renames, batchCtx);
        }
        migrateLocalization(uuid, confirmDiscard, batchCtx);
        return toView(ctx.projectId(), updated, warnings);
    }

    /**
     * Whether this save changes which of the template's editors are {@code localizable} — the only
     * CDL change that needs stored values rewritten (M24.2.2).
     */
    private boolean localizableFlagsChanged(Asset template, ContentDefinition proposed) {
        AssetVersion current = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(template.getId()).orElse(null);
        if (current == null) {
            return false;
        }
        ContentDefinition before = compileDefinition(CdlSources.of(current.getPayload()));
        return !LocalizationMigrator.localizableLeaves(before).equals(LocalizationMigrator.localizableLeaves(proposed));
    }

    /**
     * Rewrites the stored values of every page/record that uses this template into the shape its
     * new CDL declares, inside the caller's open batch. An unconfirmed save that would drop
     * translations throws, which rolls the whole save back — nothing is written, and the problem
     * tells the client what a confirmed save would discard.
     */
    private void migrateLocalization(UUID templateUuid, boolean confirmDiscard, RevisionContext batchCtx) {
        LocalizationContext target = LocalizationContext.of(projectLocales.forProject(batchCtx.projectId()));
        LocalizationMigrationService.MigrationReport report =
                localizationMigrations.migrateTemplate(batchCtx.projectId(), templateUuid, target, batchCtx, true);
        if (!report.requiresConfirmation() || confirmDiscard) {
            return;
        }
        throw new SfException(com.acme.staticforge.common.Problem.builder()
                .type("https://cms.example.com/problems/sf-api-0409")
                .title("Conflict")
                .status(409)
                .detail("Turning off language dependence would discard " + report.discardedLocaleValues()
                        + " translation(s) in " + report.affectedAssets().size()
                        + " asset(s). Re-send with confirmDiscard=true to keep only the default language.")
                .property("code", "SF-API-0409")
                .property("discardedLocaleValues", report.discardedLocaleValues())
                .property("discardedLocales", report.discardedLocales())
                .property("affectedAssets", report.affectedAssets().stream().map(UUID::toString).toList())
                .build());
    }

    @Override
    @Transactional
    public TemplateView saveChannel(UUID uuid, String channelKey, String octlSource, long expectedRevision, RevisionContext ctx) {
        Asset template = requireTemplate(ctx.projectId(), uuid);
        AssetVersion current = requireOpen(template.getId());

        ContentDefinition definition = compileDefinition(CdlSources.of(current.getPayload()));
        Map<String, String> sources = storedSources(current.getPayload());
        sources.put(channelKey, octlSource);
        CompiledChannels compiled = compileChannels(
                template.getProjectId(), template.getAssetType(), uuid, template.getUid(), sources, Set.of(channelKey),
                definition, hierarchies.live(template.getProjectId()));

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        ObjectNode channel = payload.withObject("channelTemplates").withObject(channelKey);
        channel.put("source", octlSource);
        channel.put("compiledHash", compiled.results().get(channelKey).template().hash());
        List<DescendantIssue> warnings = List.of();
        if (template.getAssetType() == AssetType.PAGE_TEMPLATE) {
            setParent(payload, compiled.parent());
            warnings = validateDescendants(template, payload, definition, descendants(template));
        }

        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx);
        return toView(ctx.projectId(), updated, warnings);
    }

    @Override
    @Transactional
    public TemplateView deleteChannel(UUID uuid, String channelKey, long expectedRevision, RevisionContext ctx) {
        Asset template = requireTemplate(ctx.projectId(), uuid);
        AssetVersion current = requireOpen(template.getId());

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        payload.withObject("channelTemplates").remove(channelKey);
        List<DescendantIssue> warnings = List.of();
        if (template.getAssetType() == AssetType.PAGE_TEMPLATE) {
            ContentDefinition definition = compileDefinition(CdlSources.of(payload));
            setParent(payload, derivedParent(template.getProjectId(), storedSources(payload)));
            warnings = validateDescendants(template, payload, definition, descendants(template));
        }

        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx);
        return toView(ctx.projectId(), updated, warnings);
    }

    @Override
    @Transactional(readOnly = true)
    public TemplateView get(long projectId, UUID uuid) {
        return toView(projectId, assetService.requireCurrent(projectId, uuid), List.of());
    }

    @Override
    @Transactional
    public Page<TemplateListItem> list(long projectId, AssetType kind, Pageable pageable, RevisionContext ctx) {
        ensureFoldersAndMigrate(projectId, ctx);
        Page<AssetSummary> page = assetService.search(new AssetQuery(projectId, kind, null, null), pageable);
        Map<UUID, JsonNode> payloads = new HashMap<>();
        if (kind == AssetType.PAGE_TEMPLATE && !page.isEmpty()) {
            for (AssetVersion version : assetVersionRepository.findCurrentByProjectAndType(projectId, kind)) {
                assetRepository.findById(version.getAssetId())
                        .ifPresent(asset -> payloads.put(asset.getUuid(), version.getPayload()));
            }
        }
        return page.map(summary -> {
            JsonNode payload = payloads.get(summary.uuid());
            return new TemplateListItem(
                    summary,
                    payload != null && payload.path("abstract").asBoolean(false),
                    TemplateHierarchy.TemplateVersion.parentTemplateRef(payload));
        });
    }

    @Override
    @Transactional(readOnly = true)
    public List<Diagnostic> validateChannel(long projectId, UUID uuid, String channelKey, String source, CdlSources cdlSource) {
        Asset template = requireTemplate(projectId, uuid);
        AssetVersion current = requireOpen(template.getId());
        CdlSources cdl = cdlSource != null ? cdlSource : CdlSources.of(current.getPayload());
        // CDL errors have their own live validation; names are checked against the best-effort definition.
        ContentDefinition definition = cdlCompiler.compile(cdl).definition();
        ReferenceResolver references = referenceResolver(projectId);
        String channel = channelKey == null ? "html" : channelKey;
        if (template.getAssetType() == AssetType.SECTION_TEMPLATE) {
            return sectionDiagnostics(octlCompiler.compile(source, channel, references, definition));
        }
        UUID parent = octlCompiler.compile(source, channel, references).template().parentUuid();
        if (parent == null) {
            parent = TemplateHierarchy.TemplateVersion.parentTemplateRef(current.getPayload());
        }
        return hierarchies.live(projectId)
                .compile(octlCompiler, references, uuid, template.getUid(), channel, source, definition, parent, null)
                .diagnostics();
    }

    @Override
    @Transactional
    public void delete(UUID uuid, RevisionContext ctx) {
        requireTemplate(ctx.projectId(), uuid);
        assetService.softDelete(uuid, false, ctx);
    }

    @Override
    @Transactional
    public TemplateView restore(UUID uuid, RevisionContext ctx) {
        Asset template = requireTemplate(ctx.projectId(), uuid);
        UUID parent = assetVersionRepository.findByAssetIdOrderByValidFromRevisionDesc(template.getId()).stream()
                .filter(version -> !version.isDeleted())
                .findFirst()
                .map(version -> TemplateHierarchy.TemplateVersion.parentTemplateRef(version.getPayload()))
                .orElse(null);
        if (parent != null) {
            boolean parentLive = assetRepository.findByProjectIdAndUuid(ctx.projectId(), parent)
                    .flatMap(asset -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                    .map(version -> !version.isDeleted())
                    .orElse(false);
            if (!parentLive) {
                throw new SfException(ProblemFactory.other(
                        409, "SF-DOM-0112", "Conflict",
                        "The template it extends has been deleted — restore that template first."));
            }
        }
        assetService.restoreDeleted(uuid, ctx);
        return get(ctx.projectId(), uuid);
    }

    // ------------------------------------------------------------------
    // Compile-on-save
    // ------------------------------------------------------------------

    private ContentDefinition compileDefinition(CdlSources source) {
        CdlResult result = cdlCompiler.compile(source);
        if (result.hasErrors()) {
            throw diagnosticsError("CDL", result.diagnostics());
        }
        return result.definition();
    }

    /**
     * Compiles a definition being saved: a section template also rejects a pagination editor (M21.1.1) and a bodies
     * section (M34: section templates have no bodies).
     */
    private ContentDefinition compileDefinition(CdlSources source, AssetType kind) {
        if (kind == AssetType.SECTION_TEMPLATE && !source.bodies().isBlank()) {
            throw diagnosticsError("CDL", List.of(new Diagnostic(Severity.ERROR, DiagnosticCodes.CDL_SYNTAX,
                    "A section template has no bodies; bodies belong to a page template.", 1, 0, CdlSources.BODIES)));
        }
        ContentDefinition definition = compileDefinition(source);
        List<Diagnostic> overlay = new ArrayList<>();
        if (kind == AssetType.SECTION_TEMPLATE) {
            PaginationCdlRules.notAllowedIn(definition, "a section template")
                    .forEach(d -> overlay.add(d.inField(CdlSources.CONTENT)));
            overlay.addAll(TemplateRuleCdlRules.sectionTemplate(definition));
        } else {
            // A page template's rule names resolve against its chain when its channels compile (M33).
            overlay.addAll(TemplateRuleCdlRules.pageTemplate(definition));
        }
        List<Diagnostic> errors = overlay.stream().filter(d -> d.severity() == Severity.ERROR).toList();
        if (!errors.isEmpty()) {
            throw diagnosticsError("CDL", errors);
        }
        return definition;
    }

    /** The channel sources, those compiled on save, and the parent they extend (page templates; {@code null} for none). */
    private record CompiledChannels(Map<String, String> sources, Map<String, OctlResult> results, UUID parent) {}

    /**
     * Compiles the {@code checked} channels of {@code sources} and rejects the save on errors. A section template
     * can't extend ({@code SF-TPL-0156}). A page template's channels must all extend the same parent
     * ({@code SF-TPL-0159}); each checked channel compiles against its chain and the CDL inherited through that
     * parent.
     */
    private CompiledChannels compileChannels(
            long projectId,
            AssetType kind,
            UUID uuid,
            String uid,
            Map<String, String> sources,
            Set<String> checked,
            ContentDefinition definition,
            TemplateHierarchy hierarchy) {
        ReferenceResolver references = referenceResolver(projectId);
        Map<String, OctlResult> results = new LinkedHashMap<>();
        if (kind == AssetType.SECTION_TEMPLATE) {
            for (String channel : checked) {
                OctlResult result = octlCompiler.compile(sources.get(channel), channel, references, definition);
                List<Diagnostic> diagnostics = sectionDiagnostics(result);
                if (diagnostics.stream().anyMatch(d -> d.severity() == Severity.ERROR)) {
                    throw diagnosticsError("OCTL", inChannel(channel, diagnostics));
                }
                results.put(channel, result);
            }
            return new CompiledChannels(sources, results, null);
        }

        UUID parent = derivedParent(projectId, sources);
        ChainCompileMemo memo = new ChainCompileMemo();
        for (String channel : checked) {
            OctlResult result = hierarchy.compile(
                    octlCompiler, references, uuid, uid, channel, sources.get(channel), definition, parent, memo);
            if (result.hasErrors()) {
                throw diagnosticsError("OCTL", inChannel(channel, result.diagnostics()));
            }
            results.put(channel, result);
        }
        return new CompiledChannels(sources, results, parent);
    }

    /** A channel's findings, each naming the channel as its field (M34) unless it points into a CDL section. */
    private static List<Diagnostic> inChannel(String channel, List<Diagnostic> diagnostics) {
        return diagnostics.stream().map(d -> d.inField("channel:" + channel)).toList();
    }

    /**
     * The parent the page template's channel sources extend, or {@code null} when none does; {@code SF-TPL-0159}
     * when they name different parents. Resolving a parent needs no chain, so this compiles without a loader.
     */
    private UUID derivedParent(long projectId, Map<String, String> sources) {
        ReferenceResolver references = referenceResolver(projectId);
        Map<UUID, String> parents = new LinkedHashMap<>();
        Map<UUID, List<String>> channelsByParent = new LinkedHashMap<>();
        sources.forEach((channel, source) -> {
            var compiled = octlCompiler.compile(source, channel, references).template();
            UUID parent = compiled.parentUuid();
            if (parent != null) {
                parents.putIfAbsent(parent, compiled.nodes().stream()
                        .filter(OctlNode.Extends.class::isInstance)
                        .map(node -> ((OctlNode.Extends) node).accessor().uid())
                        .findFirst()
                        .orElse(parent.toString()));
                channelsByParent.computeIfAbsent(parent, p -> new ArrayList<>()).add(channel);
            }
        });
        if (parents.size() > 1) {
            String detail = channelsByParent.entrySet().stream()
                    .map(entry -> String.join(", ", entry.getValue()) + " → " + parents.get(entry.getKey()))
                    .collect(Collectors.joining("; "));
            throw diagnosticsError("OCTL", List.of(Diagnostic.error(
                    DiagnosticCodes.OCTL_CHANNELS_EXTEND_DIFFERENT_PARENTS,
                    "Every channel of a page template must extend the same parent: " + detail, 0, 0)));
        }
        return parents.isEmpty() ? null : parents.keySet().iterator().next();
    }

    /** A section template compiled like any template, with {@code $CMS_EXTENDS} reported as not allowed here. */
    private static List<Diagnostic> sectionDiagnostics(OctlResult result) {
        List<OctlNode.Extends> extendsNodes = result.template().nodes().stream()
                .filter(OctlNode.Extends.class::isInstance)
                .map(OctlNode.Extends.class::cast)
                .toList();
        if (extendsNodes.isEmpty()) {
            return result.diagnostics();
        }
        List<Diagnostic> diagnostics = new ArrayList<>(result.diagnostics().stream()
                .filter(d -> !d.code().equals(DiagnosticCodes.OCTL_PARENT_UNAVAILABLE))
                .toList());
        for (OctlNode.Extends extendsNode : extendsNodes) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_EXTENDS_TARGET,
                    "Section templates can't extend another template: inheritance is for page templates",
                    extendsNode.line(), extendsNode.col()));
        }
        return diagnostics;
    }

    /** The project-scoped resolver shared with reference materialization (§16.4, §5.4). */
    private ReferenceResolver referenceResolver(long projectId) {
        return projectReferences.forProject(projectId);
    }

    private static Map<String, String> storedSources(JsonNode payload) {
        Map<String, String> sources = new LinkedHashMap<>();
        payload.path("channelTemplates").fields().forEachRemaining(
                channel -> sources.put(channel.getKey(), channel.getValue().path("source").asText("")));
        return sources;
    }

    private ObjectNode buildPayload(
            AssetType kind,
            CdlSources cdl,
            CompiledChannels compiled,
            String category,
            boolean deprecated,
            Map<String, String> outputPath,
            ContentDefinition definition,
            boolean abstractTemplate,
            Map<String, String> paginationPath) {
        ObjectNode payload = objectMapper.createObjectNode();
        cdl.writeTo(payload);
        payload.set("compiledDefinition", objectMapper.valueToTree(definition));

        ObjectNode channelTemplates = payload.putObject("channelTemplates");
        compiled.results().forEach((channelKey, result) -> {
            ObjectNode channel = channelTemplates.putObject(channelKey);
            channel.put("source", compiled.sources().get(channelKey));
            channel.put("compiledHash", result.template().hash());
        });

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
            ObjectNode pagination = payload.putObject(PAGINATION_PATH);
            paginationPath.forEach((channel, pattern) -> {
                if (pattern == null || pattern.isBlank()) {
                    return;
                }
                if (!pattern.contains("{pageNumber}")) {
                    throw new SfException(ProblemFactory.unprocessableEntity(
                            "The pagination path of channel '" + channel + "' must contain {pageNumber}, or every page would"
                                    + " be written to the same file.",
                            "field", PAGINATION_PATH + "." + channel));
                }
                pagination.put(channel, pattern);
            });
            payload.put("abstract", abstractTemplate);
            setParent(payload, compiled.parent());
        }
        return payload;
    }

    /** {@code parentTemplateRef}: derived from the channel sources on every page template save, never client-written. */
    private static void setParent(ObjectNode payload, UUID parent) {
        if (parent == null) {
            payload.putNull(PARENT_SOURCE_PATH);
        } else {
            payload.put(PARENT_SOURCE_PATH, parent.toString());
        }
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
    // Abstract templates and descendants (M20)
    // ------------------------------------------------------------------

    /** 422 {@code SF-DOM-0122} when pages still use the template that is about to become abstract. */
    private void requireNotUsedByPages(Asset template) {
        List<AssetVersion> pages = assetVersionRepository.findCurrentPagesOfTemplates(template.getProjectId(), List.of(template.getId()));
        if (pages.isEmpty()) {
            return;
        }
        List<String> uids = pages.stream().limit(LISTED_PAGES).map(page -> page.getAsset().getUid()).toList();
        throw new SfException(Problem.builder()
                .type("https://cms.example.com/problems/sf-dom-0122")
                .title("Template In Use")
                .status(422)
                .detail(pages.size() + " page" + (pages.size() == 1 ? " uses" : "s use") + " this template, so it can't be"
                        + " made abstract. Move " + (pages.size() == 1 ? "it" : "them") + " to another template first: "
                        + String.join(", ", uids) + (pages.size() > uids.size() ? ", …" : ""))
                .property("code", "SF-DOM-0122")
                .property("pageCount", pages.size())
                .property("pageUids", uids)
                .property("pageUuids", pages.stream().limit(LISTED_PAGES).map(page -> page.getAsset().getUuid()).toList())
                .build());
    }

    /**
     * Every current page template that extends {@code template}, transitively, children before grandchildren: an
     * index walk over the open {@code TEMPLATE} edges with source path {@value #PARENT_SOURCE_PATH}.
     */
    private List<Asset> descendants(Asset template) {
        List<Asset> out = new ArrayList<>();
        Set<Long> seen = new HashSet<>();
        seen.add(template.getId());
        Deque<Long> frontier = new ArrayDeque<>(List.of(template.getId()));
        while (!frontier.isEmpty()) {
            long id = frontier.poll();
            List<Long> children = assetReferenceRepository.findIncomingOpen(id).stream()
                    .filter(edge -> edge.getKind() == ReferenceKind.TEMPLATE && PARENT_SOURCE_PATH.equals(edge.getSourcePath()))
                    .map(AssetReference::getFromAssetId)
                    .filter(seen::add)
                    .toList();
            for (Asset child : assetRepository.findAllById(children)) {
                if (child.getAssetType() == AssetType.PAGE_TEMPLATE) {
                    out.add(child);
                    frontier.add(child.getId());
                }
            }
        }
        return out;
    }

    /**
     * Recompiles every descendant against the proposed version of {@code template} before anything is written
     * (M20.2.2): each descendant's effective definition and every channel. Errors reject the save with 422
     * {@code SF-DOM-0124} listing the broken descendants; warnings (a block override that no longer matches) are
     * returned. Ancestors are compiled once per channel for the whole check, and nothing here touches the shared
     * compile cache, which must never hold an unsaved version.
     *
     * <p>Race window: a descendant saved concurrently against the old version is not seen here. The next save of
     * either template re-validates, and generation's validation stage reports it at build time.
     */
    private List<DescendantIssue> validateDescendants(
            Asset template, ObjectNode proposedPayload, ContentDefinition proposedDefinition, List<Asset> descendants) {
        if (descendants.isEmpty()) {
            return List.of();
        }
        TemplateHierarchy hierarchy = hierarchies.live(template.getProjectId()).overlay(new TemplateHierarchy.TemplateVersion(
                template.getUuid(), template.getUid(), proposedPayload, proposedDefinition, -1));
        ReferenceResolver references = referenceResolver(template.getProjectId());
        ChainCompileMemo memo = new ChainCompileMemo();
        List<DescendantIssue> errors = new ArrayList<>();
        List<DescendantIssue> warnings = new ArrayList<>();
        for (Asset descendant : descendants) {
            TemplateHierarchy.TemplateVersion version = hierarchy.version(descendant.getUuid()).orElse(null);
            if (version == null) {
                continue;
            }
            List<Diagnostic> definitionErrors = hierarchy.effectiveDefinition(version).diagnostics();
            if (!definitionErrors.isEmpty()) {
                errors.add(new DescendantIssue(version.uuid(), version.uid(), null, definitionErrors));
            }
            for (Map.Entry<String, String> channel : storedSources(version.payload()).entrySet()) {
                OctlResult result = hierarchy.compile(
                        octlCompiler, references, version.uuid(), version.uid(), channel.getKey(), channel.getValue(),
                        version.ownDefinition(), version.parentTemplateRef(), memo);
                List<Diagnostic> channelErrors = result.diagnostics().stream()
                        .filter(d -> d.severity() == Severity.ERROR)
                        // A collision is reported once, for the definition, not again per channel.
                        .filter(d -> !d.code().equals(DiagnosticCodes.CDL_INHERITED_NAME_COLLISION))
                        .toList();
                List<Diagnostic> channelWarnings = result.diagnostics().stream()
                        .filter(d -> d.code().equals(DiagnosticCodes.OCTL_UNKNOWN_BLOCK_OVERRIDE))
                        .toList();
                if (!channelErrors.isEmpty()) {
                    errors.add(new DescendantIssue(version.uuid(), version.uid(), channel.getKey(), channelErrors));
                }
                if (!channelWarnings.isEmpty()) {
                    warnings.add(new DescendantIssue(version.uuid(), version.uid(), channel.getKey(), channelWarnings));
                }
            }
        }
        if (!errors.isEmpty()) {
            Set<String> broken = errors.stream().map(DescendantIssue::uid).collect(Collectors.toCollection(LinkedHashSet::new));
            throw new SfException(Problem.builder()
                    .type("https://cms.example.com/problems/sf-dom-0124")
                    .title("Descendants Would Break")
                    .status(422)
                    .detail("This change would break " + broken.size() + " template" + (broken.size() == 1 ? "" : "s")
                            + " that extend" + (broken.size() == 1 ? "s" : "") + " it: " + String.join(", ", broken))
                    .property("code", "SF-DOM-0124")
                    .property("descendants", errors)
                    .build());
        }
        return warnings;
    }

    /**
     * Applies a page template's {@code renamedFrom} hops to the {@code content} of every current page on
     * {@code templateIds} (the template and its descendants), inside the caller's open batch revision.
     */
    private void migratePageContent(long projectId, List<Long> templateIds, List<EditorRename> renames, RevisionContext batchCtx) {
        Revision revision = batchCtx.openRevision();
        List<AssetChange> changes = new ArrayList<>();
        for (AssetVersion page : assetVersionRepository.findCurrentPagesOfTemplates(projectId, templateIds)) {
            ObjectNode payload = page.getPayload().deepCopy();
            if (!(payload.get("content") instanceof ObjectNode content) || !ContentRenameMigrator.apply(content, renames)) {
                continue;
            }
            Asset asset = page.getAsset();
            close(page.getAssetId(), revision.getRevisionId());
            insertVersion(page, payload, revision.getRevisionId(), batchCtx.userId(), asset);
            changes.add(AssetChange.create(asset.getUuid().toString(), AssetType.PAGE.name(), "UPDATE", List.of("content")));
        }
        revisionService.appendSummaries(projectId, revision.getRevisionId(), changes);
    }

    // ------------------------------------------------------------------
    // CDL-change content migration (§12.3)
    // ------------------------------------------------------------------

    private void migrateRenames(Asset template, ContentDefinition definition, RevisionContext ctx) {
        List<EditorRename> renames = ContentRenameMigrator.collect(definition);
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
            Asset asset = assetRepository.findById(page.version().getAssetId())
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Page not found.")));
            close(page.version().getAssetId(), revision.getRevisionId());
            insertVersion(page.version(), page.payload(), revision.getRevisionId(), ctx.userId(), asset);
            appendSummary(asset, revision);
        }
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
                changed |= ContentRenameMigrator.apply((ObjectNode) contentNode, renames);
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

    private void insertVersion(AssetVersion current, JsonNode payload, long revisionId, Long changedBy, Asset asset) {
        insertVersion(current, payload, revisionId, changedBy, current.getFolderId(), current.getFolderPath(), asset);
    }

    /**
     * {@code asset} is wired directly onto the new row (see {@link AssetVersion#setAsset}) —
     * required whenever the caller's own transaction might read the new version back out through
     * a JPQL query joining {@code v.asset} (e.g. {@code AssetServiceImpl#search}), since the
     * session's identity map would otherwise keep handing back this very instance with a
     * still-null association — and the version's outgoing reference rows are synced in the same
     * revision (§5.4).
     */
    private void insertVersion(
            AssetVersion current, JsonNode payload, long revisionId, Long changedBy, Long folderId, String folderPath, Asset asset) {
        AssetVersion next = new AssetVersion(
                current.getAssetId(), revisionId, current.getDisplayName(), payload, changedBy, Instant.now());
        next.setFolderId(folderId);
        next.setFolderPath(folderPath);
        next.setTemplateAssetId(current.getTemplateAssetId());
        next.setDeleted(current.isDeleted());
        next.setAsset(asset);
        referenceMaterializer.materialize(asset, assetVersionRepository.save(next));
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

    /** The view; a page template's effective definition and ancestors are read live through its recorded parent. */
    private TemplateView toView(long projectId, AssetVersionView view, List<DescendantIssue> descendantWarnings) {
        UUID folderUuid = view.folderId() == null ? null : folderUuid(view.folderId());
        EffectiveDefinition effective = null;
        List<TemplateView.TemplateRef> ancestors = List.of();
        if (view.type() == AssetType.PAGE_TEMPLATE) {
            TemplateHierarchy hierarchy = hierarchies.live(projectId);
            // A deleted template isn't in the live hierarchy; its definition still reads from its own version.
            TemplateHierarchy.TemplateVersion self = hierarchy.version(view.uuid())
                    .filter(version -> version.versionKey() == view.validFromRevision())
                    .orElseGet(() -> new TemplateHierarchy.TemplateVersion(
                            view.uuid(), view.uid(), view.payload(),
                            cdlCompiler.compile(CdlSources.of(view.payload())).definition(),
                            view.validFromRevision()));
            effective = hierarchy.effectiveDefinition(self);
            ancestors = hierarchy.ancestors(view.uuid(), self.parentTemplateRef()).stream()
                    .map(ancestor -> new TemplateView.TemplateRef(ancestor.uuid(), ancestor.uid()))
                    .toList();
        }
        return new TemplateView(
                view.uuid(), view.uid(), view.type(), view.displayName(), view.payload(),
                view.validFromRevision(), view.deleted(), folderUuid, view.folderPath(),
                effective, ancestors, Objects.requireNonNullElse(descendantWarnings, List.of()));
    }

    private UUID folderUuid(Long folderId) {
        return assetRepository.findById(folderId).map(Asset::getUuid).orElse(null);
    }

    private record AffectedPage(AssetVersion version, ObjectNode payload) {}
}
