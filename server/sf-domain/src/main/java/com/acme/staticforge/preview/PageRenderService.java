package com.acme.staticforge.preview;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.dataset.RecordTemplates;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.asset.media.MediaPaths;
import com.acme.staticforge.asset.media.TextMediaCompiler;
import com.acme.staticforge.asset.media.TextMediaRenderer;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.asset.navigation.NavigationLookup;
import com.acme.staticforge.asset.navigation.NavTreeNode;
import com.acme.staticforge.asset.navigation.NavigationDiagnosticCodes;
import com.acme.staticforge.asset.navigation.NavigationHtmlRenderer;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.asset.navigation.NavigationTreeJson;
import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.asset.template.TemplateHierarchies;
import com.acme.staticforge.asset.template.TemplateHierarchy;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.pagination.PaginationItem;
import com.acme.staticforge.pagination.PaginationScope;
import com.acme.staticforge.pagination.PaginationSource;
import com.acme.staticforge.pagination.PaginationValue;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.release.ContentView;
import com.acme.staticforge.release.ContentViews;
import com.acme.staticforge.release.ReleaseProblems;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.content.EffectiveDefinition;
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
import com.acme.staticforge.template.render.RenderResult;
import com.acme.staticforge.template.render.Renderer;
import com.acme.staticforge.template.render.UrlResolver;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.IntNode;
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
    private final AssetVersionRepository assetVersionRepository;
    private final ProjectRepository projectRepository;
    private final ObjectMapper objectMapper;
    private final PreviewTokenService previewTokenService;
    private final NavigationService navigationService;
    private final ContentViews contentViews;
    private final UrlRegistryService urlRegistryService;
    private final CompiledTemplateCache compiledTemplates;
    private final BlobStore blobStore;
    private final TextMediaCompiler textMediaCompiler;
    private final TemplateHierarchies templateHierarchies;
    private final com.acme.staticforge.project.ProjectLocales projectLocales;

    private final Renderer renderer = new OctlRenderer();
    private final TextMediaRenderer textMediaRenderer = new TextMediaRenderer();

    public PageRenderService(
            AssetService assetService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            ProjectRepository projectRepository,
            ObjectMapper objectMapper,
            PreviewTokenService previewTokenService,
            NavigationService navigationService,
            ContentViews contentViews,
            UrlRegistryService urlRegistryService,
            CompiledTemplateCache compiledTemplates,
            BlobStore blobStore,
            TextMediaCompiler textMediaCompiler,
            TemplateHierarchies templateHierarchies,
            com.acme.staticforge.project.ProjectLocales projectLocales) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.projectRepository = projectRepository;
        this.objectMapper = objectMapper;
        this.previewTokenService = previewTokenService;
        this.navigationService = navigationService;
        this.contentViews = contentViews;
        this.urlRegistryService = urlRegistryService;
        this.compiledTemplates = compiledTemplates;
        this.blobStore = blobStore;
        this.textMediaCompiler = textMediaCompiler;
        this.templateHierarchies = templateHierarchies;
        this.projectLocales = projectLocales;
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
        return renderPage(projectId, pageUuid, revision, channel, rewriteLinks, baseUrl, null).html();
    }

    /**
     * Renders page {@code pageNumber} of a saved page (M21.3.1): clamped to {@code 1..totalPages} of a paginated page,
     * ignored for any other. The page count and slices come from the same {@link PaginationSource} generation uses,
     * against live data (templates and values at {@code revision}, like the rest of the preview).
     *
     * @param pageNumber the 1-based page; {@code null} for the first
     */
    public PagePreview renderPage(
            long projectId, UUID pageUuid, Long revision, String channel, boolean rewriteLinks, String baseUrl,
            Integer pageNumber) {
        return doRender(projectId, pageUuid, revision, channel, rewriteLinks, baseUrl, pageNumber, null, ContentView.Kind.DRAFT);
    }

    /**
     * Renders a saved page in one language (M24.3.2): language-dependent values resolve through
     * that language's fallback chain, {@code $CMS_META(locale)$} reports it, and {@code date}/
     * {@code number} format in it. {@code null} means the project's default language, which is what
     * a project without locales always renders.
     */
    public PagePreview renderPage(
            long projectId, UUID pageUuid, Long revision, String channel, boolean rewriteLinks, String baseUrl,
            Integer pageNumber, String locale) {
        return renderPage(projectId, pageUuid, revision, channel, rewriteLinks, baseUrl, pageNumber, locale, ContentView.Kind.DRAFT);
    }

    /**
     * Renders a saved page in one language and one view (M27.2.3): {@link ContentView.Kind#DRAFT} shows the page's draft
     * and the drafts of everything it reads (what an editor just saved), {@link ContentView.Kind#PUBLISHED} the release
     * state the next build renders — the page's released version for the language, released navigation, values and
     * records, and empty links to what isn't released. Both at {@code revision} when given.
     *
     * @throws SfException {@code 404 SF-DOM-0155} when the published view is asked for a page that exists but isn't
     *     released in that language
     */
    public PagePreview renderPage(
            long projectId, UUID pageUuid, Long revision, String channel, boolean rewriteLinks, String baseUrl,
            Integer pageNumber, String locale, ContentView.Kind view) {
        return doRender(projectId, pageUuid, revision, channel, rewriteLinks, baseUrl, pageNumber, locale, view);
    }

    /**
     * How many items a pagination source holds right now and how many entries it skips (M21.4.1): the count behind the
     * page editor's "N items → M pages" hint. Same {@link PaginationSource} and live resolvers as a paginated preview,
     * so the hint and the preview agree. The caller checks that {@code source} is a live navigation folder or dataset.
     */
    public PaginationCount countPaginationSource(long projectId, PaginationValue.Kind kind, UUID source) {
        // Only the source matters for eligibility; size and sort don't change the count.
        PaginationValue value = new PaginationValue("count", kind, source, 1,
                kind == PaginationValue.Kind.NAV ? "navigation" : "_displayName", false);
        Reading reading = reading(projectId, null, ContentView.Kind.DRAFT, null);
        PaginationSource.Result result = PaginationSource.items(
                projectId, value, navigationService, reading.navigation(), reading.values()::datasetRecords);
        return new PaginationCount(result.items().size(), result.warnings().size());
    }

    /** The eligible items of a pagination source and the entries it skipped (dangling navigation references). */
    public record PaginationCount(int itemCount, int skipped) {}

    /**
     * Renders a section template alone against sample content (spec §19.1).
     *
     * @param sectionTemplateUuid the section template UUID
     * @param sampleContent editor values to feed the section template
     * @param channel the channel key
     */
    public String renderSection(long projectId, UUID sectionTemplateUuid, JsonNode sampleContent, String channel) {
        return withRenderLimitsAsProblem(() -> renderSectionTemplate(
                projectId, projectKeyOf(projectId), sectionTemplateUuid, null, null, sampleContent, null, null, channel, false,
                null, reading(projectId, null, ContentView.Kind.DRAFT, null), new RenderBudget(), new ArrayList<>(), null));
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
        return renderMedia(projectId, media, revision, baseUrl, null, ContentView.Kind.DRAFT);
    }

    /**
     * As {@link #renderMedia(long, AssetVersionView, Long, String)}, reading values, navigation and linked media in the
     * view (and language) of the page preview that links the file (M27.2.3); {@code media} is the version that view
     * renders. Localized media renders the file of {@code locale} (M27.3.2; the default file for {@code null}).
     */
    public String renderMedia(
            long projectId, AssetVersionView media, Long revision, String baseUrl, String locale, ContentView.Kind view) {
        String projectKey = projectKeyOf(projectId);
        Reading reading = reading(projectId, revision, view, locale);
        JsonNode payload = MediaFiles.effective(
                media.payload(), locale, projectLocales.forProject(projectId).effectiveChain(locale));
        String mimeType = payload.path("mimeType").asText(null);
        String sha = payload.path("blobSha256").asText(null);
        if (sha == null) {
            throw new SfException(ProblemFactory.notFound("Media blob is missing."));
        }
        String channel = textMediaCompiler.defaultChannelKey(projectId);
        OctlResult compiled = compiledTemplates.compileTextMedia(
                projectId,
                media.uuid(),
                sha,
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
                        urlResolver(projectKey, channel, true, baseUrl, reading),
                        reading.values(),
                        (navFolderUuid, args) -> {
                            JsonNode json = navigationTreeJson(
                                    navFolderUuid, args, projectId, projectKey, null, channel, true, baseUrl, reading);
                            return json == null ? null : json.path("children");
                        })
                .output());
    }

    // ------------------------------------------------------------------
    // Saved + live entry points
    // ------------------------------------------------------------------

    private PagePreview doRender(
            long projectId, UUID pageUuid, Long revision, String channel, boolean rewriteLinks, String baseUrl,
            Integer pageNumber, String locale, ContentView.Kind kind) {
        String projectKey = projectKeyOf(projectId);
        Reading reading = reading(projectId, revision, kind, locale);

        PageView page;
        if (kind == ContentView.Kind.PUBLISHED) {
            page = reading.view().resolve(pageUuid)
                    .map(found -> PageView.from(found.view()))
                    .orElseThrow(() -> assetRepository.findByProjectIdAndUuid(projectId, pageUuid).isPresent()
                            ? ReleaseProblems.notPublished()
                            : new SfException(ProblemFactory.notFound("Page not found.")));
        } else if (revision == null) {
            page = PageView.from(assetService.requireCurrent(projectId, pageUuid));
        } else {
            AssetVersionView view = assetService
                    .findAt(projectId, pageUuid, revision)
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Page not found at revision " + revision + ".")));
            page = PageView.from(view);
        }
        PageView view = page;
        return withRenderLimits(
                () -> renderPage(projectId, projectKey, view, channel, rewriteLinks, baseUrl, reading, pageNumber, locale));
    }

    /**
     * A render limit ({@code SF-TPL-0130}–{@code 0135}, e.g. an include cycle) fails the preview
     * with a {@code 422} problem carrying the diagnostic code — the preview counterpart of
     * generation failing just the affected file — instead of surfacing as a 500.
     */
    private static String withRenderLimitsAsProblem(Supplier<String> render) {
        return withRenderLimits(render);
    }

    private static <T> T withRenderLimits(Supplier<T> render) {
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
    private PagePreview renderPage(
            long projectId,
            String projectKey,
            PageView page,
            String channel,
            boolean rewriteLinks,
            String baseUrl,
            Reading reading,
            Integer requestedPage,
            String locale) {
        AssetVersionView pageTemplate = templateAt(projectId, page.pageTemplateUuid(), reading.revision());
        CompiledTemplate compiled = compilePageTemplateChannel(pageTemplate, channel, projectId, reading.revision());
        if (compiled == null) {
            return new PagePreview("", 1, 1, List.of()); // missing channel template degrades gracefully to an empty body
        }

        // One budget for the page and every section/include/catalog card rendered inside it.
        RenderBudget budget = new RenderBudget();
        // The render warnings of the page and of every section rendered inside it (a section's own render result
        // would otherwise drop them).
        List<Diagnostic> warnings = new ArrayList<>();
        UrlResolver urlResolver = urlResolver(projectKey, channel, rewriteLinks, baseUrl, reading);
        AssetValueResolver assetValues = reading.values();
        Pagination pagination = pagination(
                projectId, projectKey, page, channel, rewriteLinks, baseUrl, reading, requestedPage, urlResolver, assetValues);
        PageView paginated = page.withPagination(pagination.scope());
        BlockResolver blocks = blockResolver(
                projectId, projectKey, paginated, channel, rewriteLinks, baseUrl, reading, budget, warnings, locale);

        RenderContext.Builder builder = RenderContext.builder()
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
                .pagination(pagination.scope())
                .urlResolver(urlResolver)
                .blockResolver(blocks)
                .assetValueResolver(assetValues)
                .budget(budget);
        if (pagination.scope() != null) {
            builder.meta("pageNumber", IntNode.valueOf(pagination.pageNumber()))
                    .meta("totalPages", IntNode.valueOf(pagination.totalPages()));
        }
        // A preview has no generated URLs, so the language switcher's hrefs stay empty here: the
        // editor switches language with the editing-locale control, not by following a link.
        com.acme.staticforge.project.LocaleRenderScope.apply(
                builder, projectLocales.forProject(projectId), locale, null);
        RenderContext context = builder.build();

        RenderResult result =
                budget.withTemplate(page.pageTemplateUuid(), pageTemplate.uid(), () -> renderer.render(compiled, context));
        addWarnings(warnings, result.warnings());
        return new PagePreview(result.output(), pagination.pageNumber(), pagination.totalPages(), warnings);
    }

    /** The preview's page of a paginated page; {@code scope} is {@code null} (page 1 of 1) for any other page. */
    private record Pagination(JsonNode scope, int pageNumber, int totalPages) {}

    /**
     * Resolves the page's pagination against live data (M21.3.1), with the same {@link PaginationSource} and
     * {@link PaginationScope} generation uses. Page links point at this preview: with {@code rewriteLinks}, the signed
     * share route of the same page and revision with {@code &page=n} (the iframe follows them without a session);
     * otherwise just {@code ?page=n}. Items link like any page link of the preview.
     */
    private Pagination pagination(
            long projectId,
            String projectKey,
            PageView page,
            String channel,
            boolean rewriteLinks,
            String baseUrl,
            Reading reading,
            Integer requestedPage,
            UrlResolver urlResolver,
            AssetValueResolver assetValues) {
        PaginationValue value = templateHierarchies.at(projectId, reading.revision())
                .effectiveDefinition(page.pageTemplateUuid())
                .map(EffectiveDefinition::definition)
                .flatMap(definition -> PaginationValue.of(definition, page.content()))
                .orElse(null);
        if (value == null) {
            return new Pagination(null, 1, 1);
        }
        List<PaginationItem> items = PaginationSource
                .items(projectId, value, navigationService, reading.navigation(), assetValues::datasetRecords)
                .items();
        int total = PaginationSource.totalPages(items.size(), value.pageSize());
        int number = Math.max(1, Math.min(requestedPage == null ? 1 : requestedPage, total));
        String shareBase = rewriteLinks
                ? (baseUrl == null ? "" : baseUrl) + "/projects/" + projectKey + "/preview/share?t="
                        + previewTokenService.issueShareToken(
                                page.uuid(), reading.revision(), channel, projectKey, reading.locale(), reading.view().kind())
                : null;
        JsonNode scope = PaginationScope.build(
                items,
                value.pageSize(),
                number,
                new PaginationScope.Links() {
                    @Override
                    public String page(int target) {
                        return shareBase == null ? "?page=" + target : shareBase + "&page=" + target;
                    }

                    @Override
                    public String item(PaginationItem item) {
                        return urlResolver.resolve("page", item.uid(), item.uuid(), Map.of());
                    }
                },
                item -> assetValues.valueOf("page", item.uuid()));
        return new Pagination(scope, number, total);
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
     * A page template's channel, compiled against its inheritance chain as of {@code revision} (M20): the
     * ancestors are the versions valid then, so time travel renders the layout the page had.
     */
    private CompiledTemplate compilePageTemplateChannel(AssetVersionView template, String channel, long projectId, Long revision) {
        JsonNode templatePayload = template.payload();
        if (templatePayload == null) {
            return null;
        }
        JsonNode channelNode = templatePayload.path("channelTemplates").path(channel);
        if (channelNode.isMissingNode() || channelNode.isNull()) {
            return null;
        }
        TemplateHierarchy hierarchy = templateHierarchies.at(projectId, revision);
        TemplateHierarchy.TemplateVersion version = hierarchy.version(template.uuid())
                .filter(found -> found.versionKey() == template.validFromRevision())
                .orElse(null);
        return compiledTemplates
                .compile(
                        projectId,
                        template.uuid(),
                        template.validFromRevision(),
                        channel,
                        templatePayload.path("contentDefinition").asText(""),
                        channelNode.path("source").asText(),
                        referenceResolver(projectId),
                        version == null ? null : hierarchy,
                        version)
                .template();
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
            Reading reading,
            RenderBudget budget,
            List<Diagnostic> warnings,
            String locale) {
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
                            projectId, projectKey, page.content(), page.pagination(), section, channel, rewriteLinks, baseUrl,
                            reading, budget, warnings, locale));
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
                            projectId, projectKey, page.content(), page.pagination(), card, channel, rewriteLinks, baseUrl,
                            reading, budget, warnings, locale));
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
                        projectId, projectKey, uuid, null, null, objectMapper.createObjectNode(), null, page.pagination(), channel,
                        rewriteLinks, baseUrl, reading, budget, warnings, locale);
            }

            @Override
            public CompiledTemplate recordTemplate(UUID datasetUuid) {
                return compileRecordTemplate(projectId, datasetUuid, channel, reading.revision());
            }

            @Override
            public String renderNavigation(UUID navFolderUuid, Map<String, String> args) {
                JsonNode json = PageRenderService.this.navigationTreeJson(
                        navFolderUuid, args, projectId, projectKey, page.uuid(), channel, rewriteLinks, baseUrl, reading);
                return json == null ? "" : NavigationHtmlRenderer.renderRoot(json);
            }

            @Override
            public String renderNavigationRecurse(JsonNode node) {
                return NavigationHtmlRenderer.renderChildren(node);
            }

            @Override
            public JsonNode resolveNavigationChildren(UUID navFolderUuid, Map<String, String> args) {
                JsonNode json = PageRenderService.this.navigationTreeJson(
                        navFolderUuid, args, projectId, projectKey, page.uuid(), channel, rewriteLinks, baseUrl, reading);
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
            String baseUrl,
            Reading reading) {
        if (navFolderUuid == null) {
            return null;
        }
        int depth = parseDepth(args);
        String navChannel = args != null && args.containsKey("channel") ? args.get("channel") : defaultChannel;

        // Diagnostics (cycle/depth-cap truncation) aren't surfaced by this preview path today —
        // renderPage already discards RenderResult.warnings() the same way, so this keeps parity
        // rather than introducing a new reporting channel just for navigation.
        NavTreeNode tree = navigationService.tree(projectId, navFolderUuid, depth, reading.navigation(), new ArrayList<>());
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
                tree, activePageUuid, node -> navHref(node, projectId, projectKey, navChannel, rewriteLinks, baseUrl, reading));
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
            NavTreeNode node,
            long projectId,
            String projectKey,
            String channel,
            boolean rewriteLinks,
            String baseUrl,
            Reading reading) {
        UUID resolvedPageUuid = node.resolvedPageUuid();
        if (resolvedPageUuid == null) {
            return "";
        }
        if (!rewriteLinks && node.type() == AssetType.PAGE_REFERENCE && urlRegistryService != null) {
            RevisionContext ctx = RevisionContext.of(projectId, null, "preview");
            return urlRegistryService.resolve(node.assetUuid(), channel, UrlArea.PREVIEW, ctx);
        }
        return urlResolver(projectKey, channel, rewriteLinks, baseUrl, reading).resolve("page", null, resolvedPageUuid, Map.of());
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
            JsonNode pagination,
            JsonNode section,
            String channel,
            boolean rewriteLinks,
            String baseUrl,
            Reading reading,
            RenderBudget budget,
            List<Diagnostic> warnings,
            String locale) {
        String templateRef = section.path("templateRef").asText();
        if (templateRef.isBlank()) {
            return "";
        }
        UUID sectionTemplateUuid = UUID.fromString(templateRef);
        JsonNode content = section.path("content");
        String instanceId = section.path("instanceId").asText();
        return renderSectionTemplate(
                projectId, projectKey, sectionTemplateUuid, null, instanceId,
                content, pageContent, pagination, channel, rewriteLinks, baseUrl, reading, budget, warnings, locale);
    }

    private String renderSectionTemplate(
            long projectId,
            String projectKey,
            UUID sectionTemplateUuid,
            String templateUid,
            String instanceId,
            JsonNode values,
            JsonNode pageValues,
            JsonNode pagination,
            String channel,
            boolean rewriteLinks,
            String baseUrl,
            Reading reading,
            RenderBudget budget,
            List<Diagnostic> warnings,
            String locale) {
        AssetVersionView template = templateAt(projectId, sectionTemplateUuid, reading.revision());
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
                .pagination(pagination)
                .urlResolver(urlResolver(projectKey, channel, rewriteLinks, baseUrl, reading))
                .blockResolver(blockResolver(
                        projectId, projectKey, PageView.contextOnly(pageValues, pagination), channel, rewriteLinks, baseUrl,
                        reading, budget, warnings, locale))
                .assetValueResolver(reading.values())
                .budget(budget);
        if (instanceId != null && !instanceId.isBlank()) {
            builder.meta("instanceId", TextNode.valueOf(instanceId));
        }
        // A section renders in its page's language (M24.3.1): its values — and a record set's records (M25.2.2) —
        // resolve through the page's fallback chain.
        com.acme.staticforge.project.LocaleRenderScope.apply(builder, projectLocales.forProject(projectId), locale, null);
        RenderContext context = builder.build();
        // A body section or catalog card (instanceId set) nests by content; only an include can recurse forever.
        RenderResult result = instanceId != null && !instanceId.isBlank()
                ? budget.withInstance(sectionTemplateUuid, uid, () -> renderer.render(compiled, context))
                : budget.withTemplate(sectionTemplateUuid, uid, () -> renderer.render(compiled, context));
        addWarnings(warnings, result.warnings());
        return result.output();
    }

    /** Adds render warnings to a page's list, each once: the same finding from several sections is one warning. */
    private static void addWarnings(List<Diagnostic> warnings, List<Diagnostic> found) {
        for (Diagnostic warning : found) {
            if (!warnings.contains(warning)) {
                warnings.add(warning);
            }
        }
    }

    /**
     * The compiled record template of dataset {@code datasetUuid} for {@code channel} (M25.2.2), from the dataset
     * version valid at {@code revision} (current when {@code null}): compiled through the cross-request cache keyed by
     * that version, like a section template, never per record. {@code null} when the dataset has none for the
     * channel (or doesn't exist then).
     */
    private CompiledTemplate compileRecordTemplate(long projectId, UUID datasetUuid, String channel, Long revision) {
        if (assetRepository.findByProjectIdAndUuid(projectId, datasetUuid).isEmpty()) {
            return null;
        }
        Optional<AssetVersionView> dataset = revision == null
                ? Optional.of(assetService.requireCurrent(projectId, datasetUuid))
                : assetService.findAt(projectId, datasetUuid, revision);
        return dataset.flatMap(version -> RecordTemplates.source(version.payload(), channel)
                        .map(source -> compiledTemplates
                                .compileRecordTemplate(
                                        projectId,
                                        datasetUuid,
                                        version.validFromRevision(),
                                        channel,
                                        version.payload().path("contentDefinition").asText(""),
                                        source,
                                        referenceResolver(projectId))
                                .template()))
                .orElse(null);
    }

    // ------------------------------------------------------------------
    // Resolvers
    // ------------------------------------------------------------------

    /**
     * What one preview render reads (M27.2.3): its {@link ContentView} — drafts or release state, at the revision, in
     * the language — and the navigation and values over it, so the page, its navigation and its values always come
     * from the same state.
     */
    private record Reading(ContentView view, String locale, NavigationLookup navigation, AssetValueResolver values) {

        /** The time-travel revision templates are read at; {@code null} for the current state. */
        Long revision() {
            return view.pinnedRevision();
        }
    }

    private Reading reading(long projectId, Long revision, ContentView.Kind kind, String locale) {
        ContentView view = contentViews.open(projectId, revision, kind == null ? ContentView.Kind.DRAFT : kind, locale);
        return new Reading(view, locale, new ContentViewNavigationLookup(view), new LiveAssetValueResolver(
                view, assetRepository, locale, projectLocales.forProject(projectId).effectiveChain(locale)));
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
    private UrlResolver urlResolver(String projectKey, String channel, boolean rewriteLinks, String baseUrl, Reading reading) {
        if (!rewriteLinks) {
            return (kind, uid, uuid, args) -> uid != null && !uid.isBlank() ? uid : (uuid == null ? "" : uuid.toString());
        }
        String base = baseUrl == null ? "" : baseUrl;
        ContentView view = reading.view();
        return (kind, uid, uuid, args) -> {
            if (uuid == null) {
                return "";
            }
            // The published view shows the site as the next build renders it: a link to a page or media file that
            // isn't released in the language renders empty there too (M27.2.3).
            if (view.kind() == ContentView.Kind.PUBLISHED
                    && ("page".equals(kind) || "media".equals(kind))
                    && view.resolve(uuid).isEmpty()) {
                return "";
            }
            if ("media".equals(kind)) {
                // Signed, unauthenticated route (mirrors the page branch below) — the plain
                // `/media/{uuid}/binary` route is Bearer-only, and this HTML's `<img src>`/link
                // is fetched by the browser directly, without the app's session. The token carries the preview's
                // view, so a published preview shows the released file.
                String variant = args == null ? null : args.get("variant");
                String mediaToken = previewTokenService.issueMediaShareToken(
                        uuid, reading.revision(), projectKey, reading.locale(), view.kind());
                String query = variant == null || variant.isBlank() ? "" : "&variant=" + variant;
                return base + "/projects/" + projectKey + "/media/" + uuid + "/share?t=" + mediaToken + query;
            }
            // Page links follow the current state, in the preview's view and language, so navigating inside the
            // frame stays in the same view.
            String token = previewTokenService.issueShareToken(uuid, null, channel, projectKey, reading.locale(), view.kind());
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

    /**
     * Immutable snapshot of the page fields the renderer needs, decoupled from the version row. {@code pagination} is
     * the page's {@code CMS_PAGINATION} value, which its sections inherit; {@code null} when not paginated.
     */
    private record PageView(
            UUID uuid,
            String uid,
            String displayName,
            String path,
            String revision,
            UUID pageTemplateUuid,
            JsonNode content,
            JsonNode bodies,
            JsonNode pagination) {

        PageView withPagination(JsonNode scope) {
            return new PageView(uuid, uid, displayName, path, revision, pageTemplateUuid, content, bodies, scope);
        }

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
                    payload == null ? null : payload.get("bodies"),
                    null);
        }

        static PageView contextOnly(JsonNode pageContent, JsonNode pagination) {
            return new PageView(null, "", "", "", "", null, pageContent, null, pagination);
        }
    }
}
