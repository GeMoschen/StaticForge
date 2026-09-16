package com.acme.staticforge.preview;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.MediaPaths;
import com.acme.staticforge.asset.media.TextMediaCompiler;
import com.acme.staticforge.asset.media.TextMediaRenderer;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.asset.navigation.LiveNavigationLookup;
import com.acme.staticforge.asset.navigation.NavTreeNode;
import com.acme.staticforge.asset.navigation.NavigationDiagnosticCodes;
import com.acme.staticforge.asset.navigation.NavigationHtmlRenderer;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.asset.navigation.NavigationTreeJson;
import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.template.render.AssetValueResolver;
import com.acme.staticforge.template.render.BlockResolver;
import com.acme.staticforge.template.render.Escaping;
import com.acme.staticforge.template.render.OctlRenderer;
import com.acme.staticforge.template.render.RenderBudget;
import com.acme.staticforge.template.render.RenderContext;
import com.acme.staticforge.template.render.RenderLimitException;
import com.acme.staticforge.template.render.Renderer;
import com.acme.staticforge.template.render.UrlResolver;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;

/**
 * Full page/section preview renderer (spec §19). Reuses the exact M2 render engine — the
 * compilers (through {@link CompiledTemplateCache}) and {@link Renderer} (an {@link OctlRenderer}) — so preview and
 * generation can never diverge in rendering behavior. Compiles the page template's channel
 * OCTL, then renders it with a {@link BlockResolver} that expands each {@code $CMS_BODY}
 * into its section instances (recursively compiling and rendering each section template's
 * channel OCTL) and each {@code $CMS_INCLUDE} into a standalone section template render.
 *
 * <p>Nothing is ever persisted here: live previews operate on an unsaved payload, and saved
 * previews only read.
 */
@Service
public class PageRenderService {

    private final AssetService assetService;
    private final AssetRepository assetRepository;
    private final ProjectRepository projectRepository;
    private final ObjectMapper objectMapper;
    private final PreviewTokenService previewTokenService;
    private final NavigationService navigationService;
    private final LiveNavigationLookup navigationLookup;
    private final UrlRegistryService urlRegistryService;
    private final CompiledTemplateCache compiledTemplates;
    private final BlobStore blobStore;
    private final TextMediaCompiler textMediaCompiler;

    private final Renderer renderer = new OctlRenderer();
    private final TextMediaRenderer textMediaRenderer = new TextMediaRenderer();

    public PageRenderService(
            AssetService assetService,
            AssetRepository assetRepository,
            ProjectRepository projectRepository,
            ObjectMapper objectMapper,
            PreviewTokenService previewTokenService,
            NavigationService navigationService,
            LiveNavigationLookup navigationLookup,
            UrlRegistryService urlRegistryService,
            CompiledTemplateCache compiledTemplates,
            BlobStore blobStore,
            TextMediaCompiler textMediaCompiler) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.projectRepository = projectRepository;
        this.objectMapper = objectMapper;
        this.previewTokenService = previewTokenService;
        this.navigationService = navigationService;
        this.navigationLookup = navigationLookup;
        this.urlRegistryService = urlRegistryService;
        this.compiledTemplates = compiledTemplates;
        this.blobStore = blobStore;
        this.textMediaCompiler = textMediaCompiler;
    }

    /**
     * Renders a saved page at its current revision.
     *
     * @param pageUuid the page asset UUID
     * @param revision optional revision to render (latest when {@code null})
     * @param channel the channel key (for example {@code "html"})
     * @param rewriteLinks whether {@code $CMS_REF} targets are rewritten to preview URLs
     */
    public String renderPage(long projectId, UUID pageUuid, Long revision, String channel, boolean rewriteLinks) {
        return renderPage(projectId, pageUuid, revision, channel, rewriteLinks, null);
    }

    /**
     * Renders a saved page, rewriting links against an explicit API base when
     * {@code rewriteLinks} is {@code true}.
     *
     * @param baseUrl the API base (for example {@code http://host/api/v1}); required for link
     *                rewriting, may be {@code null} otherwise
     */
    public String renderPage(
            long projectId, UUID pageUuid, Long revision, String channel, boolean rewriteLinks, String baseUrl) {
        return doRender(projectId, pageUuid, revision, channel, rewriteLinks, baseUrl);
    }

    /**
     * Renders a section template alone against sample content (spec §19.1).
     *
     * @param sectionTemplateUuid the section template UUID
     * @param sampleContent editor values to feed the section template
     * @param channel the channel key
     */
    public String renderSection(long projectId, UUID sectionTemplateUuid, JsonNode sampleContent, String channel) {
        return withRenderLimitsAsProblem(() -> renderSectionTemplate(
                projectId, projectKeyOf(projectId), sectionTemplateUuid, null, null, sampleContent, null, channel, false, null,
                null, new RenderBudget()));
    }

    /**
     * Renders a processed text media file for preview (M18.3.2) through the same
     * {@link TextMediaRenderer} generation uses, with live resolvers at {@code revision}: values and
     * globals as of that revision (current when {@code null}), and media links rewritten to preview
     * share URLs pinned to the same revision, so a font referenced by a processed stylesheet loads in
     * a time-travel preview too.
     *
     * @param media the media version to render, the one valid at {@code revision}
     * @param baseUrl the API base the page preview used, so links survive a reverse proxy
     * @throws SfException {@code 422} with {@code diagnostics} when the source doesn't compile, or with
     *     the limit's code when a render limit is hit
     */
    public String renderMedia(long projectId, AssetVersionView media, Long revision, String baseUrl) {
        String projectKey = projectKeyOf(projectId);
        JsonNode payload = media.payload();
        String mimeType = payload.path("mimeType").asText(null);
        String sha = payload.path("blobSha256").asText(null);
        if (sha == null) {
            throw new SfException(ProblemFactory.notFound("Media blob is missing."));
        }
        String channel = textMediaCompiler.defaultChannelKey(projectId);
        OctlResult compiled = compiledTemplates.compileTextMedia(
                projectId,
                media.uuid(),
                media.validFromRevision(),
                channel,
                TextMediaCompiler.decode(blobStore.get(sha)).text(),
                TextMediaTypes.isScriptLike(mimeType),
                referenceResolver(projectId));
        TextMediaCompiler.requireNoErrors(compiled);

        String uid = emptyIfNull(media.uid());
        TextMediaRenderer.Target target = new TextMediaRenderer.Target(
                media.uuid(),
                uid,
                media.displayName(),
                mimeType,
                MediaPaths.mediaPath(uid, MediaPaths.extensionFor(mimeType)),
                media.validFromRevision(),
                channel,
                projectKey);
        return withRenderLimitsAsProblem(() -> textMediaRenderer.render(
                        compiled.template(),
                        target,
                        urlResolver(projectKey, channel, true, baseUrl, revision),
                        assetValues(projectId, revision),
                        (navFolderUuid, args) -> {
                            JsonNode json = navigationTreeJson(
                                    navFolderUuid, args, projectId, projectKey, null, channel, true, baseUrl);
                            return json == null ? null : json.path("children");
                        })
                .output());
    }

    // ------------------------------------------------------------------
    // Saved + live entry points
    // ------------------------------------------------------------------

    private String doRender(
            long projectId, UUID pageUuid, Long revision, String channel, boolean rewriteLinks, String baseUrl) {
        String projectKey = projectKeyOf(projectId);

        PageView page;
        if (revision == null) {
            page = PageView.from(assetService.requireCurrent(projectId, pageUuid));
        } else {
            AssetVersionView view = assetService
                    .findAt(projectId, pageUuid, revision)
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Page not found at revision " + revision + ".")));
            page = PageView.from(view);
        }
        return withRenderLimitsAsProblem(() -> renderPage(projectId, projectKey, page, channel, rewriteLinks, baseUrl, revision));
    }

    /**
     * A render limit ({@code SF-TPL-0130}–{@code 0135}, e.g. an include cycle) fails the preview
     * with a {@code 422} problem carrying the diagnostic code — the preview counterpart of
     * generation failing just the affected file — instead of surfacing as a 500.
     */
    private static String withRenderLimitsAsProblem(Supplier<String> render) {
        try {
            return render.get();
        } catch (RenderLimitException e) {
            Diagnostic diagnostic = e.diagnostic();
            throw new SfException(diagnostic == null
                    ? ProblemFactory.unprocessableEntity(e.getMessage())
                    : ProblemFactory.other(422, diagnostic.code(), "Render Limit Exceeded", diagnostic.message()));
        }
    }

    // ------------------------------------------------------------------
    // Core render
    // ------------------------------------------------------------------

    /** @param revision the time-travel revision templates are read at, or {@code null} for the current state */
    private String renderPage(
            long projectId,
            String projectKey,
            PageView page,
            String channel,
            boolean rewriteLinks,
            String baseUrl,
            Long revision) {
        AssetVersionView pageTemplate = templateAt(projectId, page.pageTemplateUuid(), revision);
        CompiledTemplate compiled = compileChannel(pageTemplate, channel, projectId);
        if (compiled == null) {
            return ""; // missing channel template degrades gracefully to an empty body
        }

        // One budget for the page and every section/include/catalog card rendered inside it.
        RenderBudget budget = new RenderBudget();
        UrlResolver urlResolver = urlResolver(projectKey, channel, rewriteLinks, baseUrl, revision);
        BlockResolver blocks = blockResolver(projectId, projectKey, page, channel, rewriteLinks, baseUrl, revision, budget);
        AssetValueResolver assetValues = assetValues(projectId, revision);

        RenderContext context = RenderContext.builder()
                .channel(channel)
                .escaping(escapingFor(channel))
                .values(page.content())
                .pageValues(page.content())
                .meta("uid", TextNode.valueOf(emptyIfNull(page.uid())))
                .meta("uuid", TextNode.valueOf(page.uuid() == null ? "" : page.uuid().toString()))
                .meta("displayName", TextNode.valueOf(emptyIfNull(page.displayName())))
                .meta("path", TextNode.valueOf(emptyIfNull(page.path())))
                .meta("revision", TextNode.valueOf(emptyIfNull(page.revision())))
                .meta("channel", TextNode.valueOf(emptyIfNull(channel)))
                .meta("projectKey", TextNode.valueOf(emptyIfNull(projectKey)))
                .urlResolver(urlResolver)
                .blockResolver(blocks)
                .assetValueResolver(assetValues)
                .budget(budget)
                .build();

        return budget.withTemplate(page.pageTemplateUuid(), pageTemplate.uid(), () -> renderer.render(compiled, context))
                .output();
    }

    /**
     * The template version to render with: the current one for a live preview, the one valid at
     * {@code revision} for time travel — never a newer version.
     */
    private AssetVersionView templateAt(long projectId, UUID templateUuid, Long revision) {
        if (revision == null) {
            return assetService.requireCurrent(projectId, templateUuid);
        }
        return assetService
                .findAt(projectId, templateUuid, revision)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Template not found at revision " + revision + ".")));
    }

    /**
     * Compiles through the cross-request cache, keyed by the template version and re-validated
     * against the project's current references on every hit (see {@link CompiledTemplateCache}).
     */
    private CompiledTemplate compileChannel(AssetVersionView template, String channel, long projectId) {
        JsonNode templatePayload = template.payload();
        if (templatePayload == null) {
            return null;
        }
        JsonNode channelNode = templatePayload.path("channelTemplates").path(channel);
        if (channelNode.isMissingNode() || channelNode.isNull()) {
            return null;
        }
        return compiledTemplates
                .compile(
                        projectId,
                        template.uuid(),
                        template.validFromRevision(),
                        channel,
                        templatePayload.path("contentDefinition").asText(""),
                        channelNode.path("source").asText(),
                        referenceResolver(projectId))
                .template();
    }

    // ------------------------------------------------------------------
    // Block resolver: bodies + includes
    // ------------------------------------------------------------------

    private BlockResolver blockResolver(
            long projectId,
            String projectKey,
            PageView page,
            String channel,
            boolean rewriteLinks,
            String baseUrl,
            Long revision,
            RenderBudget budget) {
        return new BlockResolver() {
            @Override
            public String renderBody(String bodyName) {
                JsonNode sections = page.body(bodyName);
                if (sections == null || !sections.isArray()) {
                    return "";
                }
                StringBuilder out = new StringBuilder();
                for (JsonNode section : sections) {
                    out.append(renderSectionInstance(
                            projectId, projectKey, page.content(), section, channel, rewriteLinks, baseUrl, revision, budget));
                }
                return out.toString();
            }

            @Override
            public String renderCatalog(JsonNode cards) {
                if (cards == null || !cards.isArray()) {
                    return "";
                }
                StringBuilder out = new StringBuilder();
                for (JsonNode card : cards) {
                    out.append(renderSectionInstance(
                            projectId, projectKey, page.content(), card, channel, rewriteLinks, baseUrl, revision, budget));
                }
                return out.toString();
            }

            @Override
            public String renderInclude(String uid, Map<String, String> args) {
                UUID uuid = resolveSectionTemplateByUid(projectId, uid);
                if (uuid == null) {
                    return "";
                }
                return renderSectionTemplate(
                        projectId, projectKey, uuid, null, null, objectMapper.createObjectNode(), null, channel, rewriteLinks, baseUrl,
                        revision, budget);
            }

            @Override
            public String renderNavigation(UUID navFolderUuid, Map<String, String> args) {
                JsonNode json = PageRenderService.this.navigationTreeJson(
                        navFolderUuid, args, projectId, projectKey, page.uuid(), channel, rewriteLinks, baseUrl);
                return json == null ? "" : NavigationHtmlRenderer.renderRoot(json);
            }

            @Override
            public String renderNavigationRecurse(JsonNode node) {
                return NavigationHtmlRenderer.renderChildren(node);
            }

            @Override
            public JsonNode resolveNavigationChildren(UUID navFolderUuid, Map<String, String> args) {
                JsonNode json = PageRenderService.this.navigationTreeJson(
                        navFolderUuid, args, projectId, projectKey, page.uuid(), channel, rewriteLinks, baseUrl);
                return json == null ? null : json.path("children");
            }
        };
    }

    // ------------------------------------------------------------------
    // Navigation ($CMS_NAVIGATION, $CMS_FOR(... : nav:uid))
    // ------------------------------------------------------------------

    /**
     * Builds the resolved navigation folder's tree as {@link NavigationTreeJson}'s JSON shape, or
     * {@code null} when unresolvable — the shared data step behind both the default HTML renderer
     * ({@code renderNavigation}) and direct template access to nav nodes ({@code
     * resolveNavigationChildren}, `M8.3.x`), mirroring {@code GenerationRenderer}'s equivalent
     * refactor so depth-parsing, channel resolution, and the dangling-reference check live in
     * exactly one place.
     */
    private JsonNode navigationTreeJson(
            UUID navFolderUuid,
            Map<String, String> args,
            long projectId,
            String projectKey,
            UUID activePageUuid,
            String defaultChannel,
            boolean rewriteLinks,
            String baseUrl) {
        if (navFolderUuid == null) {
            return null;
        }
        int depth = parseDepth(args);
        String navChannel = args != null && args.containsKey("channel") ? args.get("channel") : defaultChannel;

        // Diagnostics (cycle/depth-cap truncation) aren't surfaced by this preview path today —
        // renderPage already discards RenderResult.warnings() the same way, so this keeps parity
        // rather than introducing a new reporting channel just for navigation.
        NavTreeNode tree = navigationService.tree(projectId, navFolderUuid, depth, navigationLookup, new ArrayList<>());
        if (tree == null) {
            return null;
        }

        List<UUID> dangling = NavigationTreeJson.danglingPageReferences(tree);
        if (!dangling.isEmpty()) {
            // `M8.2.3`: mirrors GenerationRenderer's dangling-reference handling — a dangling
            // PAGE_REFERENCE used to silently render as a non-linked <span>; fail the render with
            // a diagnostic instead. Preview has no diagnostics-reporting channel (see the comment
            // above), so this surfaces as a thrown SfException, consistent with every other
            // unresolvable-asset failure in this class (e.g. `assetService.requireCurrent`).
            throw new SfException(ProblemFactory.other(
                    422,
                    NavigationDiagnosticCodes.NAV_DANGLING_PAGE_REFERENCE,
                    "Unresolvable Navigation Reference",
                    "Navigation reference '" + dangling.get(0) + "' does not resolve to any page."));
        }

        return NavigationTreeJson.toJson(
                tree, activePageUuid, node -> navHref(node, projectId, projectKey, navChannel, rewriteLinks, baseUrl));
    }

    /**
     * Href resolution swap point for `M8.2.3`: a {@code PAGE_REFERENCE} node's href is keyed on
     * the reference's own uuid ({@code node.assetUuid()}, exactly the {@code pageReferenceUuid}
     * {@link UrlRegistryService#resolve} expects) and resolved through the {@code PREVIEW} area of
     * the URL registry — but only when {@code rewriteLinks} is {@code false} (a caller inspecting
     * the registry's stable, published-style URL rather than rendering something a browser will
     * actually click). When {@code rewriteLinks} is {@code true} (every iframe/srcdoc preview
     * route — see {@link #urlResolver}'s javadoc), the registry's raw output-relative path (e.g.
     * {@code "about/index.html"}) is not a route the preview app serves, so it must go through the
     * same signed-share-token {@link UrlResolver} every other in-preview page link uses, exactly
     * like a {@code FOLDER} entry-point node already does — otherwise nav links render but cannot
     * be clicked to navigate inside the preview. A {@code FOLDER} entry-point node (its {@code
     * resolvedPageUuid} comes from walking a {@code startNode} chain, not from a {@code
     * PageReference} the folder itself owns) has no {@code PageReference} identity to key a
     * registry lookup on regardless, so it always resolves directly through the {@link
     * UrlResolver} — unchanged pre-`M8.2.3` behavior for that node kind.
     */
    private String navHref(
            NavTreeNode node, long projectId, String projectKey, String channel, boolean rewriteLinks, String baseUrl) {
        UUID resolvedPageUuid = node.resolvedPageUuid();
        if (resolvedPageUuid == null) {
            return "";
        }
        if (!rewriteLinks && node.type() == AssetType.PAGE_REFERENCE && urlRegistryService != null) {
            RevisionContext ctx = RevisionContext.of(projectId, null, "preview");
            return urlRegistryService.resolve(node.assetUuid(), channel, UrlArea.PREVIEW, ctx);
        }
        // Page links are never revision-pinned, so the media revision doesn't matter here.
        return urlResolver(projectKey, channel, rewriteLinks, baseUrl, null).resolve("page", null, resolvedPageUuid, Map.of());
    }

    /** {@code depth} named arg → int, {@code -1} (unlimited, still hard-capped) when absent/invalid. */
    private static int parseDepth(Map<String, String> args) {
        String raw = args == null ? null : args.get("depth");
        if (raw == null || raw.isBlank()) {
            return -1;
        }
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private String renderSectionInstance(
            long projectId,
            String projectKey,
            JsonNode pageContent,
            JsonNode section,
            String channel,
            boolean rewriteLinks,
            String baseUrl,
            Long revision,
            RenderBudget budget) {
        String templateRef = section.path("templateRef").asText();
        if (templateRef.isBlank()) {
            return "";
        }
        UUID sectionTemplateUuid = UUID.fromString(templateRef);
        JsonNode content = section.path("content");
        String instanceId = section.path("instanceId").asText();
        return renderSectionTemplate(
                projectId, projectKey, sectionTemplateUuid, null, instanceId,
                content, pageContent, channel, rewriteLinks, baseUrl, revision, budget);
    }

    private String renderSectionTemplate(
            long projectId,
            String projectKey,
            UUID sectionTemplateUuid,
            String templateUid,
            String instanceId,
            JsonNode values,
            JsonNode pageValues,
            String channel,
            boolean rewriteLinks,
            String baseUrl,
            Long revision,
            RenderBudget budget) {
        AssetVersionView template = templateAt(projectId, sectionTemplateUuid, revision);
        CompiledTemplate compiled = compileChannel(template, channel, projectId);
        if (compiled == null) {
            return ""; // section template has no channel template
        }

        String uid = templateUid != null ? templateUid : template.uid();

        RenderContext.Builder builder = RenderContext.builder()
                .channel(channel)
                .escaping(escapingFor(channel))
                .values(values != null ? values : objectMapper.createObjectNode())
                .pageValues(pageValues != null ? pageValues : objectMapper.createObjectNode())
                .meta("uid", TextNode.valueOf(uid))
                .meta("uuid", TextNode.valueOf(sectionTemplateUuid.toString()))
                .urlResolver(urlResolver(projectKey, channel, rewriteLinks, baseUrl, revision))
                .blockResolver(blockResolver(
                        projectId, projectKey, PageView.contextOnly(pageValues), channel, rewriteLinks, baseUrl, revision, budget))
                .assetValueResolver(assetValues(projectId, revision))
                .budget(budget);
        if (instanceId != null && !instanceId.isBlank()) {
            builder.meta("instanceId", TextNode.valueOf(instanceId));
        }
        RenderContext context = builder.build();
        return budget.withTemplate(sectionTemplateUuid, uid, () -> renderer.render(compiled, context)).output();
    }

    // ------------------------------------------------------------------
    // Resolvers
    // ------------------------------------------------------------------

    /** Cross-asset values at the preview's revision (current when {@code revision} is {@code null}). */
    private AssetValueResolver assetValues(long projectId, Long revision) {
        return new LiveAssetValueResolver(assetService, assetRepository, projectId, revision);
    }

    private ReferenceResolver referenceResolver(long projectId) {
        return (assetType, uid) -> {
            AssetType type = AssetReferencePrefixes.assetTypeForRef(assetType);
            if (type == null) {
                return Optional.empty();
            }
            boolean nav = "nav".equals(assetType);
            Optional<UUID> resolved = assetRepository
                    .findByProjectIdAndAssetTypeAndUid(projectId, type, nav ? FolderScope.navigationReferenceUid(uid) : uid)
                    .map(Asset::getUuid);
            if (resolved.isPresent() && nav && !isNavigationFolder(projectId, resolved.get())) {
                // Same rationale as GenerationRenderer: a folder's uid is unique per (project,
                // FOLDER), not per store — reject anything not actually NAVIGATION-scoped.
                return Optional.empty();
            }
            return resolved;
        };
    }

    private boolean isNavigationFolder(long projectId, UUID folderUuid) {
        return FolderScope.fromPayload(assetService.requireCurrent(projectId, folderUuid).payload()) == FolderScope.NAVIGATION;
    }

    private UUID resolveSectionTemplateByUid(long projectId, String uid) {
        if (uid == null || uid.isBlank()) {
            return null;
        }
        return assetRepository
                .findByProjectIdAndAssetTypeAndUid(projectId, AssetType.SECTION_TEMPLATE, uid)
                .map(Asset::getUuid)
                .orElse(null);
    }

    /**
     * Internal page links are rewritten to the signed, unauthenticated {@code /preview/share}
     * route (not the Bearer-only {@code /preview/pages/{uuid}}) — this HTML is loaded into the
     * browser's own iframe navigation (not Angular's authenticated {@code HttpClient}) whenever
     * the viewer clicks a link inside the preview, so the auth has to travel in the URL itself.
     *
     * @param revision the time-travel revision media share links are pinned to (M18.3.2), so a
     *     processed file renders with that revision's values; {@code null} for the current state
     */
    private UrlResolver urlResolver(String projectKey, String channel, boolean rewriteLinks, String baseUrl, Long revision) {
        if (!rewriteLinks) {
            return (kind, uid, uuid, args) -> uid != null && !uid.isBlank() ? uid : (uuid == null ? "" : uuid.toString());
        }
        String base = baseUrl == null ? "" : baseUrl;
        return (kind, uid, uuid, args) -> {
            if (uuid == null) {
                return "";
            }
            if ("media".equals(kind)) {
                // Signed, unauthenticated route (mirrors the page branch below) — the plain
                // `/media/{uuid}/binary` route is Bearer-only, and this HTML's `<img src>`/link
                // is fetched by the browser directly, without the app's session.
                String variant = args == null ? null : args.get("variant");
                String mediaToken = previewTokenService.issueMediaShareToken(uuid, revision, projectKey);
                String query = variant == null || variant.isBlank() ? "" : "&variant=" + variant;
                return base + "/projects/" + projectKey + "/media/" + uuid + "/share?t=" + mediaToken + query;
            }
            String token = previewTokenService.issueShareToken(uuid, null, channel, projectKey);
            return base + "/projects/" + projectKey + "/preview/share?t=" + token;
        };
    }

    private static Escaping escapingFor(String channel) {
        if ("markdown".equals(channel)) {
            return Escaping.MARKDOWN;
        }
        return Escaping.HTML;
    }

    private static String emptyIfNull(String value) {
        return value == null ? "" : value;
    }

    // ------------------------------------------------------------------
    // Identity lookups
    // ------------------------------------------------------------------

    private String projectKeyOf(long projectId) {
        return projectRepository.findById(projectId).map(Project::getKey).orElse("");
    }

    // ------------------------------------------------------------------
    // Page view + helpers
    // ------------------------------------------------------------------

    /** Immutable snapshot of the page fields the renderer needs, decoupled from the version row. */
    private record PageView(
            UUID uuid,
            String uid,
            String displayName,
            String path,
            String revision,
            UUID pageTemplateUuid,
            JsonNode content,
            JsonNode bodies) {

        JsonNode body(String name) {
            return bodies == null ? null : bodies.path(name);
        }

        static PageView from(AssetVersionView view) {
            JsonNode payload = view.payload();
            String templateRef = payload == null ? "" : payload.path("templateRef").asText();
            return new PageView(
                    view.uuid(),
                    view.uid(),
                    view.displayName(),
                    view.folderPath() == null ? "" : view.folderPath(),
                    String.valueOf(view.validFromRevision()),
                    templateRef.isBlank() ? null : UUID.fromString(templateRef),
                    payload == null ? null : payload.get("content"),
                    payload == null ? null : payload.get("bodies"));
        }

        static PageView contextOnly(JsonNode pageContent) {
            return new PageView(null, "", "", "", "", null, pageContent, null);
        }
    }
}
