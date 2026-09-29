package com.acme.staticforge.generate.render;

import com.fasterxml.jackson.databind.node.BooleanNode;
import com.acme.staticforge.asset.page.PageNav;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.dataset.RecordTemplates;
import com.acme.staticforge.asset.folder.AssetReferencePrefixes;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.media.TextMediaRenderer;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.asset.navigation.NavTreeNode;
import com.acme.staticforge.asset.navigation.NavigationDiagnosticCodes;
import com.acme.staticforge.asset.navigation.NavigationHtmlRenderer;
import com.acme.staticforge.asset.navigation.NavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.asset.navigation.NavigationServiceImpl;
import com.acme.staticforge.asset.navigation.NavigationTreeJson;
import com.acme.staticforge.asset.template.CompiledChannel;
import com.acme.staticforge.asset.template.TemplateCompileMemo;
import com.acme.staticforge.asset.template.TemplateHierarchy;
import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.OutputPathExpander;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.nav.SnapshotNavigationLookup;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.PaginatedPage;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.quality.ReferenceEvent;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.pagination.PaginationItem;
import com.acme.staticforge.pagination.PaginationScope;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.template.render.BlockResolver;
import com.acme.staticforge.template.render.Escaping;
import com.acme.staticforge.template.render.OctlRenderer;
import com.acme.staticforge.template.render.RenderBudget;
import com.acme.staticforge.template.render.RenderContext;
import com.acme.staticforge.template.render.RenderLimitException;
import com.acme.staticforge.template.render.RenderResult;
import com.acme.staticforge.template.render.Renderer;
import com.acme.staticforge.template.render.UrlResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.TextNode;
import io.micrometer.core.instrument.Metrics;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Renders a single (page, channel) unit into a {@link RenderedFile} against a revision-pinned
 * {@link Snapshot} (spec §18.2 RENDER). Mirrors {@code preview.PageRenderService} but resolves
 * all references, section templates and URLs from the snapshot rather than the live
 * repositories, so generation and preview share the exact same render engine. All mutable
 * render state is scoped to a single {@link #render} call, so one instance is safe to share
 * across concurrent virtual threads.
 *
 * <p>A renderer renders one language view of the snapshot (M27.2.1): the pipeline holds one per language, and every
 * entry renders with its language's renderer. A reference to an asset absent from that view because it isn't
 * released there renders empty with {@code SF-GEN-0221}, exactly where a tombstone renders empty with
 * {@code SF-GEN-0220}.
 */
final class GenerationRenderer {

    /** A URL that starts with a scheme ({@code https:}, {@code mailto:}) — never rewritten by {@link #relativeUrl}. */

    private final Snapshot snapshot;
    private final OutputPathResolver paths;
    private final String projectKey;
    private final ChannelService channelService;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<AssetType, Map<String, UUID>> uidIndex;
    private final TemplateCompileMemo compiledTemplates;
    private SnapshotAssetValueResolver assetValues;

    private final Renderer renderer = new OctlRenderer();
    private final TextMediaRenderer textMediaRenderer = new TextMediaRenderer();

    // NavigationServiceImpl is pure/stateless (no dependencies) — instantiated directly, same as
    // renderer above, rather than threaded in as a Spring bean.
    private final NavigationService navigationService = new NavigationServiceImpl();
    private final NavigationLookup navigationLookup;

    /** The project's content locales (M24.3.1); {@link com.acme.staticforge.project.LocaleConfig#EMPTY} is single-language. */
    private com.acme.staticforge.project.LocaleConfig localeConfig = com.acme.staticforge.project.LocaleConfig.EMPTY;

    /** Where media links point per render locale (M27.3.2); follows {@link #localeConfig}. */
    private MediaOutputs mediaOutputs;

    /** Whether rendered section instances are marked for a draft check (M30.3.1); never in a build. */
    private boolean sectionMarkers;

    GenerationRenderer(
            Snapshot snapshot,
            OutputPathResolver paths,
            String projectKey,
            ChannelService channelService) {
        this(snapshot, paths, projectKey, channelService, new TemplateCompileMemo(Metrics.globalRegistry));
    }

    /**
     * @param compiledTemplates the build's compile memo — shared by every renderer of the same
     *     snapshot (see {@code CompiledTemplateCache#buildMemo}), so each (template, channel)
     *     compiles once per build; the shorter constructor uses a memo private to this renderer
     */
    GenerationRenderer(
            Snapshot snapshot,
            OutputPathResolver paths,
            String projectKey,
            ChannelService channelService,
            TemplateCompileMemo compiledTemplates) {
        this.snapshot = snapshot;
        this.paths = paths;
        this.projectKey = projectKey == null ? "" : projectKey;
        this.channelService = channelService;
        this.uidIndex = indexUids(snapshot.root());
        this.navigationLookup = new SnapshotNavigationLookup(snapshot);
        this.compiledTemplates = compiledTemplates;
        this.assetValues = new SnapshotAssetValueResolver(snapshot, compiledTemplates);
        this.mediaOutputs = new MediaOutputs(snapshot, localeConfig, paths == null ? null : paths.registry());
    }

    /**
     * Sets the project's locale configuration for this build (M24.3.1). Set once by the pipeline
     * before any entry renders; without it the renderer behaves as a single-language project.
     */
    GenerationRenderer withLocales(com.acme.staticforge.project.LocaleConfig config) {
        this.localeConfig = config == null ? com.acme.staticforge.project.LocaleConfig.EMPTY : config;
        this.mediaOutputs = new MediaOutputs(snapshot, localeConfig, paths == null ? null : paths.registry());
        // Before any entry renders, so nothing has been memoized yet: media values read the view's locale file.
        this.assetValues = new SnapshotAssetValueResolver(snapshot, compiledTemplates, localeConfig);
        return this;
    }

    /**
     * Marks every rendered section instance with {@code <!--sf:section {instanceId}-->…<!--/sf:section-->} where a
     * comment is harmless ({@link SectionMarkerWriter}) — for the draft check render (M30.3.1) only: a build never sets
     * it, so generation output stays byte-identical. Set before any entry renders.
     */
    GenerationRenderer withSectionMarkers() {
        this.sectionMarkers = true;
        return this;
    }

    /** How often this build's dataset record index was built (M19.3.2): at most once per snapshot. */
    int recordIndexBuilds() {
        return assetValues.indexBuilds();
    }

    /** Renders one plan entry; produces empty bytes (with no deps) when the template has no channel source. */
    RenderedFile render(PlanEntry entry) {
        SnapshotAsset page = snapshot.assetByUuid(entry.pageUuid());
        if (page == null) {
            return new RenderedFile(entry.outputPath(), new byte[0], Set.of(), List.of());
        }
        SnapshotAsset template = templateOf(snapshot, page);
        if (template == null) {
            return new RenderedFile(entry.outputPath(), new byte[0], Set.of(), List.of());
        }
        CompiledTemplate compiled = compileChannel(template, entry.channel());
        if (compiled == null) {
            return new RenderedFile(
                    entry.outputPath(),
                    new byte[0],
                    Set.of(),
                    List.of(Diagnostic.warning(
                            GenerationDiagnosticCodes.GEN_CHANNEL_MISSING,
                            "Page '" + emptyIfNull(page.uid()) + "' has no '" + entry.channel()
                                    + "' channel template; skipping.",
                            0,
                            0)));
        }

        JsonNode content = page.payload() == null ? null : page.payload().get("content");
        if (content == null || !content.isObject()) {
            content = mapper.createObjectNode();
        }
        JsonNode bodies = page.payload() == null ? null : page.payload().get("bodies");

        Set<UUID> deps = new LinkedHashSet<>();
        List<Diagnostic> warnings = new ArrayList<>();
        List<ReferenceEvent> events = new ArrayList<>();

        // One budget for the page and every section/include/catalog card rendered inside it.
        RenderBudget budget = new RenderBudget();
        UrlResolver urlResolver = urlResolver(entry.channel(), entry.outputPath(), warnings, events, entry.locale());
        JsonNode pagination = paginationScope(entry, deps, warnings);
        BlockResolver blocks = blockResolver(
                content, bodies, entry.channel(), entry.pageUuid(), entry.outputPath(), pagination, deps, warnings,
                events, budget, entry.locale());

        RenderContext.Builder builder = RenderContext.builder()
                .channel(entry.channel())
                .escaping(escapingFor(entry.channel()))
                .values(content)
                .pageValues(content)
                .meta("uid", TextNode.valueOf(emptyIfNull(page.uid())))
                .meta("uuid", TextNode.valueOf(emptyIfNull(page.uuid().toString())))
                .meta("displayName", TextNode.valueOf(emptyIfNull(page.displayName())))
                .meta("path", TextNode.valueOf(entry.outputPath()))
                .meta("revision", TextNode.valueOf(String.valueOf(snapshot.revision())))
                .meta("channel", TextNode.valueOf(emptyIfNull(entry.channel())))
                .meta("projectKey", TextNode.valueOf(projectKey))
                // The language's own nav.noIndex (M30): a template writes the robots meta from it.
                .meta(PageNav.NO_INDEX, BooleanNode.valueOf(PageNav.noIndex(page.payload())))
                .pagination(pagination)
                .urlResolver(urlResolver)
                .blockResolver(blocks)
                .assetValueResolver(assetValues)
                .budget(budget);
        if (entry.pagination() != null) {
            builder.meta("pageNumber", IntNode.valueOf(entry.pagination().pageNumber()))
                    .meta("totalPages", IntNode.valueOf(entry.pagination().totalPages()));
        }
        // The render locale, its fallback chain and the CMS_LOCALES language switcher (M24.3.1).
        com.acme.staticforge.project.LocaleRenderScope.apply(
                builder, localeConfig, entry.locale(), target -> localeHref(entry, page, target));
        RenderContext context = builder.build();

        RenderResult result = budget.withTemplate(template.uuid(), template.uid(), () -> renderer.render(compiled, context));
        deps.addAll(result.dependencies());
        warnings.addAll(result.warnings());

        String output = sectionMarkers ? SectionMarkerWriter.finish(result.output()) : result.output();
        return new RenderedFile(entry.outputPath(), output.getBytes(StandardCharsets.UTF_8), deps, warnings, events);
    }

    /**
     * The {@code CMS_PAGINATION} value of a paginated entry (M21.3.1), or {@code null}: the slice of the items the
     * planner resolved, with page and item links relative to this entry's output path. The source and every item
     * (not only this page's) are dependencies, and the source's warnings are reported with page 1.
     */
    private JsonNode paginationScope(PlanEntry entry, Set<UUID> deps, List<Diagnostic> warnings) {
        if (entry.pagination() == null) {
            return null;
        }
        PaginatedPage page = entry.pagination().page();
        deps.add(page.sourceUuid());
        page.items().forEach(item -> deps.add(item.uuid()));
        if (entry.pagination().pageNumber() == 1) {
            warnings.addAll(page.warnings());
        }
        String channel = entry.channel();
        return PaginationScope.build(
                page.items(),
                page.pageSize(),
                entry.pagination().pageNumber(),
                new PaginationScope.Links() {
                    @Override
                    public String page(int number) {
                        String path = page.path(number);
                        return relativeUrl(entry.outputPath(), paths == null ? path : paths.paginationUrl(path, channel));
                    }

                    @Override
                    public String item(PaginationItem item) {
                        // The item in this entry's language: {locale}-prefixed paths, like every other page link (M24).
                        return paths == null
                                ? ""
                                : relativeUrl(entry.outputPath(), paths.resolvePageUrl(item.uuid(), channel, entry.locale()));
                    }
                },
                item -> assetValues.valueOf("page", item.uuid()));
    }

    /**
     * Renders a processed text media file (M18.3.1) to its output path, through the shared
     * {@link TextMediaRenderer} with this build's snapshot resolvers: links are relative to the media
     * file's own output path, values and globals come from the snapshot, {@code nav:} iteration uses
     * the snapshot navigation. A localized file renders in the locale it is written for (M27.3.2), with this
     * renderer being that locale's. The source compiles once per build through the compile memo.
     * Compile-time warnings were shown when the file was saved and are not repeated here; render-time
     * warnings (a deleted target, a missing value) are returned like a page's.
     *
     * @param output the media output to render ({@link MediaOutputs})
     * @param source the media file's source text (its blob, decoded)
     * @param channel the project's default channel, the only one media renders in
     * @throws RenderLimitException when the source no longer compiles against the snapshot (e.g. a
     *     referenced uid was renamed after the save) or a render limit is hit: this file fails, the
     *     rest of the build does not
     */
    RenderedFile renderMedia(MediaOutputs.Output output, String source, String channel) {
        SnapshotAsset media = output.renderedAsset();
        String mimeType = output.mimeType();
        String uid = emptyIfNull(media.uid());
        String outputPath = output.path();
        String locale = output.key().locale();

        OctlResult compiled = compiledTemplates.textMedia(
                media.uuid(), channel, source, TextMediaTypes.isScriptLike(mimeType), referenceResolver());
        Optional<Diagnostic> error = compiled.diagnostics().stream()
                .filter(d -> d.severity() == com.acme.staticforge.template.diagnostic.Severity.ERROR)
                .findFirst();
        if (error.isPresent()) {
            throw new RenderLimitException(error.get());
        }

        Set<UUID> deps = new LinkedHashSet<>();
        List<Diagnostic> warnings = new ArrayList<>();
        List<ReferenceEvent> events = new ArrayList<>();
        TextMediaRenderer.Target target = new TextMediaRenderer.Target(
                media.uuid(), uid, media.displayName(), mimeType, outputPath, snapshot.revision(), channel, projectKey);
        RenderResult result = textMediaRenderer.render(
                compiled.template(),
                target,
                urlResolver(channel, outputPath, warnings, events, locale),
                assetValues,
                (navFolderUuid, args) -> {
                    JsonNode json = navigationTreeJson(navFolderUuid, args, channel, null, outputPath, deps, warnings);
                    return json == null ? null : json.path("children");
                });
        deps.addAll(result.dependencies());
        warnings.addAll(result.warnings());
        return new RenderedFile(outputPath, result.output().getBytes(StandardCharsets.UTF_8), deps, warnings, events);
    }

    /** Compiles the template's channel and returns ERROR-severity diagnostics (empty when clean). */
    List<Diagnostic> compileErrors(SnapshotAsset template, String channel) {
        JsonNode payload = template.payload();
        if (payload == null) {
            return List.of();
        }
        List<Diagnostic> errors = new ArrayList<>();
        JsonNode channelNode = payload.path("channelTemplates").path(channel);
        if (channelNode.isMissingNode() || channelNode.isNull()) {
            return List.of();
        }
        OctlResult result = compile(template, channel).octl();
        result.diagnostics().stream()
                .filter(d -> d.severity() == com.acme.staticforge.template.diagnostic.Severity.ERROR)
                .forEach(errors::add);
        return errors;
    }

    /** The page template for a page, or {@code null} when missing, soft-deleted or unresolvable. */
    static SnapshotAsset templateOf(Snapshot snapshot, SnapshotAsset page) {
        JsonNode payload = page.payload();
        if (payload == null) {
            return null;
        }
        String ref = payload.path("templateRef").asText();
        if (ref.isBlank()) {
            return null;
        }
        try {
            SnapshotAsset template = snapshot.assetByUuid(UUID.fromString(ref));
            return template == null || template.deleted() ? null : template;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    // ------------------------------------------------------------------
    // Compilation and resolvers
    // ------------------------------------------------------------------

    private CompiledTemplate compileChannel(SnapshotAsset template, String channel) {
        JsonNode payload = template.payload();
        if (payload == null) {
            return null;
        }
        JsonNode channelNode = payload.path("channelTemplates").path(channel);
        if (channelNode.isMissingNode() || channelNode.isNull() || channelNode.path("source").asText().isBlank()) {
            return null;
        }
        return compile(template, channel).template();
    }

    /**
     * Compiles through the build memo: once per (template, channel) for the whole build. A page template compiles
     * against its inheritance chain in the snapshot (M20).
     */
    private CompiledChannel compile(SnapshotAsset template, String channel) {
        JsonNode payload = template.payload();
        if (template.type() == AssetType.PAGE_TEMPLATE) {
            return compiledTemplates.compilePageTemplate(
                    template.uuid(),
                    template.uid(),
                    channel,
                    payload.path("contentDefinition").asText(""),
                    payload.path("channelTemplates").path(channel).path("source").asText(),
                    referenceResolver(),
                    SnapshotTemplateHierarchy.of(snapshot, compiledTemplates),
                    TemplateHierarchy.TemplateVersion.parentTemplateRef(payload));
        }
        return compiledTemplates.compile(
                template.uuid(),
                channel,
                payload.path("contentDefinition").asText(""),
                payload.path("channelTemplates").path(channel).path("source").asText(),
                referenceResolver());
    }

    private ReferenceResolver referenceResolver() {
        return (assetType, uid) -> {
            AssetType type = AssetReferencePrefixes.assetTypeForRef(assetType);
            if (type == null) {
                return Optional.empty();
            }
            Map<String, UUID> byUid = uidIndex.get(type);
            if (byUid == null) {
                return Optional.empty();
            }
            boolean nav = "nav".equals(assetType);
            UUID resolved = byUid.get(nav ? FolderScope.navigationReferenceUid(uid) : uid);
            if (resolved != null && nav && !isNavigationFolder(resolved)) {
                // A folder's uid is unique per (project, FOLDER), not per store, so a bare
                // FOLDER-type uid lookup for a "nav:" reference can resolve outside the Navigation
                // store entirely (e.g. nav:templates_root). Reject anything that isn't actually
                // NAVIGATION-scoped rather than silently rendering an unrelated store's subtree.
                return Optional.empty();
            }
            return Optional.ofNullable(resolved);
        };
    }

    private boolean isNavigationFolder(UUID uuid) {
        SnapshotAsset asset = snapshot.assetByUuid(uuid);
        return asset != null && !asset.deleted() && FolderScope.fromPayload(asset.payload()) == FolderScope.NAVIGATION;
    }

    /**
     * @param pagePath output path of the page being rendered; generated links are relative to it
     * @param events collects every reference that renders empty because its target is deleted, unreleased or missing
     *     (M30.1.3): the quality checks report them on this output
     * @param renderLocale the language links resolve in, so a German page links to German pages
     *     (M24.3.2). {@code $CMS_REF(page:x, locale="en")} overrides it for one reference when it names one of the
     *     project's languages; any other value links in the render language.
     */
    private UrlResolver urlResolver(
            String channel, String pagePath, List<Diagnostic> warnings, List<ReferenceEvent> events, String renderLocale) {
        return (kind, uid, uuid, args) -> {
            if (uuid == null) {
                return "";
            }
            String locale = linkLocale(args, renderLocale);
            String eventLocale = "page".equals(kind) ? locale : renderLocale;
            // A page link resolves in the language it links to; media and folders in the render language's view.
            SnapshotAsset target = ("page".equals(kind) ? snapshot.in(locale) : snapshot).assetByUuid(uuid);
            if (target != null && target.unreleased()) {
                warnUnreleasedReference(warnings, kind, uid, pagePath, eventLocale);
                record(events, ReferenceEvent.Kind.UNRELEASED, kind, uuid, target.uid(), eventLocale);
                return "";
            }
            if (target != null && target.deleted()) {
                warnDeletedReference(warnings, kind, uid);
                record(events, ReferenceEvent.Kind.DELETED, kind, uuid, target.uid(), eventLocale);
                return "";
            }
            if (target == null && ("page".equals(kind) || "media".equals(kind) || "folder".equals(kind))) {
                // Not in the snapshot at all (a foreign or hard-deleted uuid): it renders empty instead of failing
                // the run (M30.1.3), and the linking output gets the finding.
                record(events, ReferenceEvent.Kind.MISSING, kind, uuid, null, eventLocale);
                return "";
            }
            return switch (kind) {
                case "media" -> relativeUrl(pagePath, resolveMedia(uuid, args, renderLocale));
                case "page" -> paths == null ? "" : relativeUrl(pagePath, paths.resolvePageUrl(uuid, channel, locale));
                case "folder" -> resolveFolder(uuid, channel, pagePath, renderLocale);
                default -> "";
            };
        };
    }

    /**
     * The current page's URL in {@code target}, relative to this entry's own output path — what a
     * {@code CMS_LOCALES} language switcher links to (M24.3.1). Empty when the page has no URL in
     * that language — including when it isn't released there (M27.2.1).
     */
    private String localeHref(PlanEntry entry, SnapshotAsset page, String target) {
        if (paths == null || page == null) {
            return "";
        }
        SnapshotAsset inTarget = snapshot.asset(page.uuid(), target);
        if (inTarget == null || inTarget.deleted()) {
            return "";
        }
        try {
            return relativeUrl(entry.outputPath(), paths.resolvePageUrl(page.uuid(), entry.channel(), target));
        } catch (RuntimeException e) {
            return "";
        }
    }

    /** The site path a media reference from {@code renderLocale} links: that locale's file (M27.3.2). */
    private String resolveMedia(UUID uuid, Map<String, String> args, String renderLocale) {
        MediaOutputs.Output output = mediaOutputs.of(uuid, renderLocale);
        if (output == null) {
            return "";
        }
        String variant = args == null ? null : args.get("variant");
        if (variant == null || variant.isBlank()) {
            return output.path();
        }
        String path = output.variantPath(variant);
        return path == null ? "" : path;
    }

    /** The language a page link resolves in: {@code locale=} when it is one of the project's languages, else the render's. */
    private String linkLocale(Map<String, String> args, String renderLocale) {
        String requested = args == null ? null : args.get("locale");
        if (requested == null || requested.isBlank() || !localeConfig.isLocalized()) {
            return renderLocale;
        }
        String declared = localeConfig.canonicalDeclared(requested);
        return declared != null ? declared : renderLocale;
    }

    /**
     * The URL a {@code $CMS_REF(folder:…)} links (spec §16.4): the folder's index page — its page with the channel's
     * {@code indexUid} in the render language's view — like any page link; without one, the
     * folder's directory ({@code {locale}/{folder}}, the site root as {@code ./}). Relative to the rendering page.
     */
    private String resolveFolder(UUID uuid, String channel, String pagePath, String renderLocale) {
        SnapshotAsset folder = snapshot.assetByUuid(uuid);
        if (folder == null) {
            return "";
        }
        UUID indexPage = paths == null
                ? null
                : navigationService.indexPage(snapshot.projectId(), uuid, channelNavigation(channel)).orElse(null);
        if (indexPage != null) {
            return relativeUrl(pagePath, paths.resolvePageUrl(indexPage, channel, renderLocale));
        }
        if (paths == null) {
            return relativeUrl(pagePath, OutputPathExpander.folderUrl(folder.folderPath(), OutputPathExpander.LocaleContext.NONE));
        }
        return relativeUrl(pagePath, paths.resolveFolderUrl(uuid, folder.folderPath(), channel, renderLocale));
    }

    /** This view's navigation, with {@code channel}'s {@code indexUid} naming a folder's index page. */
    private NavigationLookup channelNavigation(String channel) {
        ChannelOutputSettings settings = paths == null ? ChannelOutputSettings.defaults(channel) : paths.settingsFor(channel);
        return navigationLookup.withIndexUid(settings.indexUid());
    }

    /** See {@link SiteLinks#relativeUrl}; the renderer's name for it. */
    static String relativeUrl(String pagePath, String sitePath) {
        return SiteLinks.relativeUrl(pagePath, sitePath);
    }

    // ------------------------------------------------------------------
    // Blocks (bodies + includes)
    // ------------------------------------------------------------------

    /**
     * @param locale the render language, threaded into nested navigation renders (M24.3.2) and into the sections,
     *     includes and catalog cards rendered inside the page, whose values resolve through its chain
     */
    private BlockResolver blockResolver(
            JsonNode pageContent,
            JsonNode bodies,
            String channel,
            UUID activePageUuid,
            String pagePath,
            JsonNode pagination,
            Set<UUID> deps,
            List<Diagnostic> warnings,
            List<ReferenceEvent> events,
            RenderBudget budget,
            String locale) {
        return new BlockResolver() {
            @Override
            public String renderBody(String bodyName) {
                JsonNode sections = bodies == null ? null : bodies.get(bodyName);
                if (sections == null || !sections.isArray()) {
                    return "";
                }
                StringBuilder out = new StringBuilder();
                for (JsonNode section : sections) {
                    out.append(renderSectionInstance(
                            pageContent, section, channel, activePageUuid, pagePath, pagination, deps, warnings, events,
                            budget, locale));
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
                            pageContent, card, channel, activePageUuid, pagePath, pagination, deps, warnings, events,
                            budget, locale));
                }
                return out.toString();
            }

            @Override
            public String renderInclude(String uid, Map<String, String> args) {
                UUID uuid = resolveByUid(AssetType.SECTION_TEMPLATE, uid);
                if (uuid == null) {
                    return "";
                }
                return renderSection(
                        uuid, mapper.createObjectNode(), pageContent, channel, activePageUuid, pagePath, null, pagination, deps,
                        warnings, events, budget, locale);
            }

            @Override
            public String renderNavigation(UUID navFolderUuid, Map<String, String> args) {
                JsonNode json = GenerationRenderer.this.navigationTreeJson(
                        navFolderUuid, args, channel, activePageUuid, pagePath, deps, warnings, locale);
                return json == null ? "" : NavigationHtmlRenderer.renderRoot(json);
            }

            @Override
            public String renderNavigationRecurse(JsonNode node) {
                return NavigationHtmlRenderer.renderChildren(node);
            }

            @Override
            public JsonNode resolveNavigationChildren(UUID navFolderUuid, Map<String, String> args) {
                JsonNode json = GenerationRenderer.this.navigationTreeJson(
                        navFolderUuid, args, channel, activePageUuid, pagePath, deps, warnings, locale);
                return json == null ? null : json.path("children");
            }

            @Override
            public CompiledTemplate recordTemplate(UUID datasetUuid) {
                return GenerationRenderer.this.recordTemplate(datasetUuid, channel);
            }
        };
    }

    /**
     * The compiled record template of dataset {@code datasetUuid} for {@code channel} (M25.2.2), from the snapshot:
     * compiled once per (dataset, channel) and build through the build memo and shared by every record of every set
     * rendered with it. {@code null} when the dataset has none for the channel.
     */
    private CompiledTemplate recordTemplate(UUID datasetUuid, String channel) {
        SnapshotAsset dataset = snapshot.assetByUuid(datasetUuid);
        if (dataset == null || dataset.type() != AssetType.DATASET) {
            return null;
        }
        return RecordTemplates.source(dataset.payload(), channel)
                .map(source -> compiledTemplates
                        .compileRecordTemplate(
                                datasetUuid,
                                channel,
                                dataset.payload().path("contentDefinition").asText(""),
                                source,
                                referenceResolver())
                        .template())
                .orElse(null);
    }

    // ------------------------------------------------------------------
    // Navigation ($CMS_NAVIGATION, $CMS_FOR(... : nav:uid))
    // ------------------------------------------------------------------

    /**
     * Builds the resolved navigation folder's tree as {@link NavigationTreeJson}'s JSON shape, or
     * {@code null} when unresolvable — the shared data step behind both the default HTML renderer
     * ({@code renderNavigation}) and direct template access to nav nodes ({@code
     * resolveNavigationChildren}, `M8.3.x`), so depth-parsing, channel resolution, the dangling-
     * reference check (`SF-GEN-0411`), and dependency-tracking live in exactly one place.
     */
    private JsonNode navigationTreeJson(
            UUID navFolderUuid,
            Map<String, String> args,
            String defaultChannel,
            UUID activePageUuid,
            String pagePath,
            Set<UUID> deps,
            List<Diagnostic> warnings) {
        return navigationTreeJson(navFolderUuid, args, defaultChannel, activePageUuid, pagePath, deps, warnings, null);
    }

    /** @param locale the render language: nav labels resolve through its chain and hrefs stay in it (M24.3.2) */
    private JsonNode navigationTreeJson(
            UUID navFolderUuid,
            Map<String, String> args,
            String defaultChannel,
            UUID activePageUuid,
            String pagePath,
            Set<UUID> deps,
            List<Diagnostic> warnings,
            String locale) {
        if (navFolderUuid == null) {
            return null;
        }
        int depth = parseDepth(args);
        String navChannel = args != null && args.containsKey("channel") ? args.get("channel") : defaultChannel;

        List<Diagnostic> navDiagnostics = new ArrayList<>();
        NavTreeNode tree = navigationService.tree(
                snapshot.projectId(), navFolderUuid, depth, channelNavigation(navChannel), navDiagnostics,
                localeConfig.effectiveChain(locale));
        warnings.addAll(navDiagnostics);
        if (tree == null) {
            return null;
        }
        deps.add(navFolderUuid);

        List<UUID> dangling = NavigationTreeJson.danglingPageReferences(tree);
        if (!dangling.isEmpty()) {
            // `M8.2.3`: a dangling PAGE_REFERENCE (its target asset is missing/deleted, or a
            // FOLDER target with no navigable page anywhere in its subtree) used to silently
            // render as a non-linked <span> — fail this page's render with a diagnostic instead
            // of emitting a broken link. Reuses RenderLimitException as the established "abort
            // this page's render, carry a Diagnostic" vehicle (RenderPipeline.renderEntry already
            // catches it and reports the diagnostic verbatim as a build ERROR) — not itself a
            // render-limit condition, but the same single-page-abort contract applies.
            throw new RenderLimitException(Diagnostic.error(
                    NavigationDiagnosticCodes.NAV_DANGLING_PAGE_REFERENCE,
                    "Navigation reference '" + dangling.get(0) + "' does not resolve to any page.",
                    0,
                    0));
        }

        return NavigationTreeJson.toJson(tree, activePageUuid, node -> navHref(node, navChannel, pagePath, locale));
    }

    /**
     * A navigation entry's href: the URL of the page it resolves to, like any page link — its registered URL (M32.3),
     * relative to the rendering page. A page reference or navigation folder has no URL of its own.
     */
    private String navHref(NavTreeNode node, String channel, String pagePath, String locale) {
        UUID resolvedPageUuid = node.resolvedPageUuid();
        if (resolvedPageUuid == null) {
            return "";
        }
        return paths == null ? "" : relativeUrl(pagePath, paths.resolvePageUrl(resolvedPageUuid, channel, locale));
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
            JsonNode pageContent,
            JsonNode section,
            String channel,
            UUID activePageUuid,
            String pagePath,
            JsonNode pagination,
            Set<UUID> deps,
            List<Diagnostic> warnings,
            List<ReferenceEvent> events,
            RenderBudget budget,
            String locale) {
        String templateRef = section.path("templateRef").asText();
        if (templateRef.isBlank()) {
            return "";
        }
        UUID sectionUuid;
        try {
            sectionUuid = UUID.fromString(templateRef);
        } catch (IllegalArgumentException e) {
            return "";
        }
        JsonNode values = section.path("content");
        String instanceId = section.path("instanceId").asText();
        String output = renderSection(
                sectionUuid, values, pageContent, channel, activePageUuid, pagePath, instanceId, pagination, deps, warnings,
                events, budget, locale);
        return sectionMarkers ? SectionMarkerWriter.wrap(instanceId, output) : output;
    }

    private String renderSection(
            UUID sectionUuid,
            JsonNode values,
            JsonNode pageValues,
            String channel,
            UUID activePageUuid,
            String pagePath,
            String instanceId,
            JsonNode pagination,
            Set<UUID> deps,
            List<Diagnostic> warnings,
            List<ReferenceEvent> events,
            RenderBudget budget,
            String locale) {
        SnapshotAsset template = snapshot.assetByUuid(sectionUuid);
        if (template == null) {
            return "";
        }
        if (template.deleted()) {
            warnDeletedReference(warnings, "section_template", template.uid());
            record(events, ReferenceEvent.Kind.DELETED, "section_template", sectionUuid, template.uid(), locale);
            return "";
        }
        CompiledTemplate compiled = compileChannel(template, channel);
        if (compiled == null) {
            return "";
        }

        RenderContext.Builder builder = RenderContext.builder()
                .channel(channel)
                .escaping(escapingFor(channel))
                .values(values != null ? values : mapper.createObjectNode())
                .pageValues(pageValues != null ? pageValues : mapper.createObjectNode())
                .meta("uid", TextNode.valueOf(emptyIfNull(template.uid())))
                .meta("uuid", TextNode.valueOf(sectionUuid.toString()))
                .pagination(pagination)
                .urlResolver(urlResolver(channel, pagePath, warnings, events, locale))
                .blockResolver(blockResolver(
                        pageValues, null, channel, activePageUuid, pagePath, pagination, deps, warnings, events, budget,
                        locale))
                .assetValueResolver(assetValues)
                .budget(budget);
        if (instanceId != null && !instanceId.isBlank()) {
            builder.meta("instanceId", TextNode.valueOf(instanceId));
        }
        // A section renders in its page's language (M24.3.1): its values — and a record set's records (M25.2.2) —
        // resolve through the page's fallback chain.
        com.acme.staticforge.project.LocaleRenderScope.apply(builder, localeConfig, locale, null);

        RenderContext context = builder.build();
        // A body section or catalog card (instanceId set) nests by content; only an include can recurse forever.
        RenderResult result = instanceId != null && !instanceId.isBlank()
                ? budget.withInstance(sectionUuid, template.uid(), () -> renderer.render(compiled, context))
                : budget.withTemplate(sectionUuid, template.uid(), () -> renderer.render(compiled, context));
        deps.addAll(result.dependencies());
        warnings.addAll(result.warnings());
        return result.output();
    }

    // ------------------------------------------------------------------
    // Lookups and helpers
    // ------------------------------------------------------------------

    private UUID resolveByUid(AssetType type, String uid) {
        if (uid == null || uid.isBlank()) {
            return null;
        }
        Map<String, UUID> byUid = uidIndex.get(type);
        return byUid == null ? null : byUid.get(uid);
    }

    /**
     * {@code type -> uid -> uuid} over every language view of the snapshot. Soft-deleted and unreleased assets are
     * indexed too, so a reference to such a target resolves (and renders empty with a warning, spec §16.4, M27.2.1)
     * instead of failing compilation as unknown; an asset present in some view always wins a uid it shares with an
     * absent one. The index is the same for every language — templates compile once per build, whatever language
     * compiles them first — so a uid released under an older name in one language and renamed in another resolves
     * under both names.
     */
    private static Map<AssetType, Map<String, UUID>> indexUids(Snapshot root) {
        Map<AssetType, Map<String, UUID>> index = new java.util.HashMap<>();
        Set<UUID> present = new java.util.HashSet<>();
        for (Snapshot view : root.views()) {
            for (SnapshotAsset asset : view.byUuid().values()) {
                if (asset.uid() == null) {
                    continue;
                }
                Map<String, UUID> byUid = index.computeIfAbsent(asset.type(), t -> new java.util.HashMap<>());
                if (asset.deleted()) {
                    byUid.putIfAbsent(asset.uid(), asset.uuid());
                } else {
                    UUID previous = byUid.get(asset.uid());
                    if (previous == null || !present.contains(previous)) {
                        byUid.put(asset.uid(), asset.uuid());
                    }
                    present.add(asset.uuid());
                }
            }
        }
        return index;
    }

    /**
     * One {@code SF-GEN-0221} per unreleased target per page and language (M27.2.1), naming the output that holds the
     * reference, the language and the target.
     */
    private static void warnUnreleasedReference(
            List<Diagnostic> warnings, String kind, String uid, String pagePath, String locale) {
        Diagnostic warning = Diagnostic.warning(
                GenerationDiagnosticCodes.GEN_UNRELEASED_REFERENCE,
                "'" + emptyIfNull(pagePath) + "'" + (locale == null ? "" : " (" + locale + ")")
                        + ": reference to unreleased " + kind + " '" + emptyIfNull(uid) + "' renders empty.",
                0,
                0);
        if (!warnings.contains(warning)) {
            warnings.add(warning);
        }
    }

    /** Records one unresolved reference per target, kind and language (the same reference may render many times). */
    private static void record(
            List<ReferenceEvent> events, ReferenceEvent.Kind kind, String targetKind, UUID target, String uid, String locale) {
        ReferenceEvent event = new ReferenceEvent(kind, targetKind, target, uid, locale);
        if (!events.contains(event)) {
            events.add(event);
        }
    }

    /** One {@code SF-GEN-0220} per deleted target per page (the same reference may render many times). */
    private static void warnDeletedReference(List<Diagnostic> warnings, String kind, String uid) {
        Diagnostic warning = Diagnostic.warning(
                GenerationDiagnosticCodes.GEN_DELETED_REFERENCE,
                "Reference to deleted " + kind + " '" + emptyIfNull(uid) + "' renders empty.",
                0,
                0);
        if (!warnings.contains(warning)) {
            warnings.add(warning);
        }
    }

    private Escaping escapingFor(String channel) {
        if (channelService != null) {
            return channelService.defaultEscaping(snapshot.projectId(), channel);
        }
        return fallbackEscaping(channel);
    }

    /** Historic fallback (used only when no {@link ChannelService} is wired): html→HTML, markdown→MARKDOWN. */
    private static Escaping fallbackEscaping(String channel) {
        if ("markdown".equals(channel)) {
            return Escaping.MARKDOWN;
        }
        return Escaping.HTML;
    }

    private static String emptyIfNull(String value) {
        return value == null ? "" : value;
    }
}
