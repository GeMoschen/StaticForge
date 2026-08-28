package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.navigation.NavTreeNode;
import com.acme.staticforge.asset.navigation.NavigationDiagnosticCodes;
import com.acme.staticforge.asset.navigation.NavigationHtmlRenderer;
import com.acme.staticforge.asset.navigation.NavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.asset.navigation.NavigationServiceImpl;
import com.acme.staticforge.asset.navigation.NavigationTreeJson;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.nav.SnapshotNavigationLookup;
import com.acme.staticforge.generate.pipeline.MediaPaths;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.template.render.BlockResolver;
import com.acme.staticforge.template.render.Escaping;
import com.acme.staticforge.template.render.OctlRenderer;
import com.acme.staticforge.template.render.RenderContext;
import com.acme.staticforge.template.render.RenderLimitException;
import com.acme.staticforge.template.render.RenderResult;
import com.acme.staticforge.template.render.Renderer;
import com.acme.staticforge.template.render.UrlResolver;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
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
 */
final class GenerationRenderer {

    private final Snapshot snapshot;
    private final OutputPathResolver paths;
    private final String projectKey;
    private final ChannelService channelService;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<AssetType, Map<String, UUID>> uidIndex;

    private final OctlCompiler octlCompiler = new OctlCompiler();
    private final CdlCompiler cdlCompiler = new CdlCompiler();
    private final Renderer renderer = new OctlRenderer();

    // NavigationServiceImpl is pure/stateless (no dependencies) — instantiated directly, same as
    // octlCompiler/cdlCompiler/renderer above, rather than threaded in as a Spring bean.
    private final NavigationService navigationService = new NavigationServiceImpl();
    private final NavigationLookup navigationLookup;

    // `M8.2.3`: the URL registry a nav node's PAGE_REFERENCE href resolves through
    // (UrlArea.GENERATED). May be null in tests/`RenderPipeline.validate()` (which never invokes
    // navHref) — navHref falls back to the pre-`M8.2.3` direct OutputPathResolver path when null,
    // the same graceful-degradation convention `channelService`/`paths` already use in this class.
    private final UrlRegistryService urlRegistryService;
    private final Long generationUserId;

    GenerationRenderer(
            Snapshot snapshot,
            OutputPathResolver paths,
            String projectKey,
            ChannelService channelService) {
        this(snapshot, paths, projectKey, channelService, null, null);
    }

    GenerationRenderer(
            Snapshot snapshot,
            OutputPathResolver paths,
            String projectKey,
            ChannelService channelService,
            UrlRegistryService urlRegistryService,
            Long generationUserId) {
        this.snapshot = snapshot;
        this.paths = paths;
        this.projectKey = projectKey == null ? "" : projectKey;
        this.channelService = channelService;
        this.uidIndex = indexUids(snapshot);
        this.navigationLookup = new SnapshotNavigationLookup(snapshot);
        this.urlRegistryService = urlRegistryService;
        this.generationUserId = generationUserId;
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

        UrlResolver urlResolver = urlResolver(entry.channel());
        BlockResolver blocks = blockResolver(content, bodies, entry.channel(), entry.pageUuid(), deps, warnings);

        RenderContext context = RenderContext.builder()
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
                .urlResolver(urlResolver)
                .blockResolver(blocks)
                .build();

        RenderResult result = renderer.render(compiled, context);
        deps.addAll(result.dependencies());
        warnings.addAll(result.warnings());

        return new RenderedFile(
                entry.outputPath(), result.output().getBytes(StandardCharsets.UTF_8), deps, warnings);
    }

    /** Compiles the template's channel and returns ERROR-severity diagnostics (empty when clean). */
    List<Diagnostic> compileErrors(SnapshotAsset template, String channel) {
        JsonNode payload = template.payload();
        if (payload == null) {
            return List.of();
        }
        List<Diagnostic> errors = new ArrayList<>();
        ContentDefinition definition = cdlCompiler.compile(payload.path("contentDefinition").asText("")).definition();
        JsonNode channelNode = payload.path("channelTemplates").path(channel);
        if (channelNode.isMissingNode() || channelNode.isNull()) {
            return List.of();
        }
        OctlResult result = octlCompiler.compile(channelNode.path("source").asText(), channel, referenceResolver(), definition);
        result.diagnostics().stream()
                .filter(d -> d.severity() == com.acme.staticforge.template.diagnostic.Severity.ERROR)
                .forEach(errors::add);
        return errors;
    }

    /** The page template for a page, or {@code null} when missing/unresolvable. */
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
            return snapshot.assetByUuid(UUID.fromString(ref));
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
        ContentDefinition definition = cdlCompiler.compile(payload.path("contentDefinition").asText("")).definition();
        return octlCompiler.compile(channelNode.path("source").asText(), channel, referenceResolver(), definition).template();
    }

    private ReferenceResolver referenceResolver() {
        return (assetType, uid) -> {
            AssetType type = assetTypeForRef(assetType);
            if (type == null) {
                return Optional.empty();
            }
            Map<String, UUID> byUid = uidIndex.get(type);
            if (byUid == null) {
                return Optional.empty();
            }
            UUID resolved = byUid.get(uid);
            if (resolved != null && "nav".equals(assetType) && !isNavigationFolder(resolved)) {
                // A folder's uid is unique per (project, FOLDER), not per store — "root" is the
                // uid of the single shared hidden folder that parents every store (Templates/
                // Pages/Media/Navigation alike, see PathService#ROOT_UID), so a bare FOLDER-type
                // uid lookup for a "nav:" reference can resolve outside the Navigation store
                // entirely. Reject anything that isn't actually NAVIGATION-scoped rather than
                // silently rendering an unrelated store's subtree as if it were navigation.
                return Optional.empty();
            }
            return Optional.ofNullable(resolved);
        };
    }

    private boolean isNavigationFolder(UUID uuid) {
        SnapshotAsset asset = snapshot.assetByUuid(uuid);
        return asset != null && FolderScope.fromPayload(asset.payload()) == FolderScope.NAVIGATION;
    }

    /**
     * {@code assetType:uid} accessor kind -> {@link AssetType}. Every kind but {@code nav} maps
     * 1:1 onto an {@link AssetType} enum name; {@code nav:<uid>} (`M8.1.4`) is special-cased since
     * a navigation folder is still just {@link AssetType#FOLDER} under the hood (`M8.1.2` — plain
     * folders, no dedicated navigation-folder asset type).
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

    private UrlResolver urlResolver(String channel) {
        return (kind, uid, uuid, args) -> {
            if (uuid == null) {
                return "";
            }
            return switch (kind) {
                case "media" -> resolveMedia(uuid, args);
                case "page" -> paths == null ? "" : paths.resolvePageUrl(uuid, channel);
                case "folder" -> resolveFolder(uuid);
                default -> "";
            };
        };
    }

    private String resolveMedia(UUID uuid, Map<String, String> args) {
        SnapshotAsset media = snapshot.assetByUuid(uuid);
        if (media == null) {
            return "";
        }
        String uid = media.uid() == null ? "" : media.uid();
        JsonNode payload = media.payload();
        String variant = args == null ? null : args.get("variant");
        if (variant == null || variant.isBlank()) {
            String mime = payload == null ? null : payload.path("mimeType").asText();
            return MediaPaths.mediaPath(uid, MediaPaths.extensionFor(mime));
        }
        JsonNode variants = payload == null ? null : payload.get("variants");
        if (variants != null && variants.isArray()) {
            for (JsonNode node : variants) {
                if (variant.equals(node.path("name").asText())) {
                    return MediaPaths.variantPath(uid, variant, extensionForFormat(node.path("format").asText()));
                }
            }
        }
        return "";
    }

    private String resolveFolder(UUID uuid) {
        SnapshotAsset folder = snapshot.assetByUuid(uuid);
        if (folder == null) {
            return "";
        }
        return relativeFolder(folder.folderPath());
    }

    private static String relativeFolder(String folderPath) {
        if (folderPath == null || folderPath.isBlank() || "/".equals(folderPath)) {
            return "";
        }
        String path = folderPath.replace('\\', '/');
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        return path.isEmpty() ? "" : (path.endsWith("/") ? path : path + "/");
    }

    // ------------------------------------------------------------------
    // Blocks (bodies + includes)
    // ------------------------------------------------------------------

    private BlockResolver blockResolver(
            JsonNode pageContent, JsonNode bodies, String channel, UUID activePageUuid, Set<UUID> deps, List<Diagnostic> warnings) {
        return new BlockResolver() {
            @Override
            public String renderBody(String bodyName) {
                JsonNode sections = bodies == null ? null : bodies.get(bodyName);
                if (sections == null || !sections.isArray()) {
                    return "";
                }
                StringBuilder out = new StringBuilder();
                for (JsonNode section : sections) {
                    out.append(renderSectionInstance(pageContent, section, channel, activePageUuid, deps, warnings));
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
                    out.append(renderSectionInstance(pageContent, card, channel, activePageUuid, deps, warnings));
                }
                return out.toString();
            }

            @Override
            public String renderInclude(String uid, Map<String, String> args) {
                UUID uuid = resolveByUid(AssetType.SECTION_TEMPLATE, uid);
                if (uuid == null) {
                    return "";
                }
                return renderSection(uuid, mapper.createObjectNode(), pageContent, channel, activePageUuid, null, deps, warnings);
            }

            @Override
            public String renderNavigation(UUID navFolderUuid, Map<String, String> args) {
                JsonNode json = GenerationRenderer.this.navigationTreeJson(
                        navFolderUuid, args, channel, activePageUuid, deps, warnings);
                return json == null ? "" : NavigationHtmlRenderer.renderRoot(json);
            }

            @Override
            public String renderNavigationRecurse(JsonNode node) {
                return NavigationHtmlRenderer.renderChildren(node);
            }

            @Override
            public JsonNode resolveNavigationChildren(UUID navFolderUuid, Map<String, String> args) {
                JsonNode json = GenerationRenderer.this.navigationTreeJson(
                        navFolderUuid, args, channel, activePageUuid, deps, warnings);
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
     * resolveNavigationChildren}, `M8.3.x`), so depth-parsing, channel resolution, the dangling-
     * reference check (`SF-GEN-0411`), and dependency-tracking live in exactly one place.
     */
    private JsonNode navigationTreeJson(
            UUID navFolderUuid, Map<String, String> args, String defaultChannel, UUID activePageUuid, Set<UUID> deps, List<Diagnostic> warnings) {
        if (navFolderUuid == null) {
            return null;
        }
        int depth = parseDepth(args);
        String navChannel = args != null && args.containsKey("channel") ? args.get("channel") : defaultChannel;

        List<Diagnostic> navDiagnostics = new ArrayList<>();
        NavTreeNode tree = navigationService.tree(snapshot.projectId(), navFolderUuid, depth, navigationLookup, navDiagnostics);
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

        return NavigationTreeJson.toJson(tree, activePageUuid, node -> navHref(node, navChannel));
    }

    /**
     * Href resolution swap point for `M8.2.3`: a {@code PAGE_REFERENCE} node's href is keyed on
     * the reference's own uuid ({@code node.assetUuid()}, exactly the {@code pageReferenceUuid}
     * {@link UrlRegistryService#resolve} expects) and resolved through the {@code GENERATED} area
     * of the URL registry — cached after the first call, stable across subsequent generation runs
     * even if the target page's slug/displayName changes, until an explicit reset. A {@code
     * FOLDER} entry-point node (its {@code resolvedPageUuid} comes from walking a {@code
     * startNode} chain, not from a {@code PageReference} the folder itself owns) has no {@code
     * PageReference} identity to key a registry lookup on, so it keeps resolving directly via
     * {@link OutputPathResolver} — unchanged pre-`M8.2.3` behavior for that node kind.
     */
    private String navHref(NavTreeNode node, String channel) {
        UUID resolvedPageUuid = node.resolvedPageUuid();
        if (resolvedPageUuid == null) {
            return "";
        }
        if (node.type() == AssetType.PAGE_REFERENCE && urlRegistryService != null) {
            RevisionContext ctx = RevisionContext.of(snapshot.projectId(), generationUserId, "generation");
            return urlRegistryService.resolve(node.assetUuid(), channel, UrlArea.GENERATED, ctx);
        }
        return paths == null ? "" : paths.resolvePageUrl(resolvedPageUuid, channel);
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
            JsonNode pageContent, JsonNode section, String channel, UUID activePageUuid, Set<UUID> deps, List<Diagnostic> warnings) {
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
        return renderSection(sectionUuid, values, pageContent, channel, activePageUuid, instanceId, deps, warnings);
    }

    private String renderSection(
            UUID sectionUuid,
            JsonNode values,
            JsonNode pageValues,
            String channel,
            UUID activePageUuid,
            String instanceId,
            Set<UUID> deps,
            List<Diagnostic> warnings) {
        SnapshotAsset template = snapshot.assetByUuid(sectionUuid);
        if (template == null) {
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
                .urlResolver(urlResolver(channel))
                .blockResolver(blockResolver(pageValues, null, channel, activePageUuid, deps, warnings));
        if (instanceId != null && !instanceId.isBlank()) {
            builder.meta("instanceId", TextNode.valueOf(instanceId));
        }

        RenderResult result = renderer.render(compiled, builder.build());
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

    private static Map<AssetType, Map<String, UUID>> indexUids(Snapshot snapshot) {
        Map<AssetType, Map<String, UUID>> index = new java.util.HashMap<>();
        for (SnapshotAsset asset : snapshot.byUuid().values()) {
            if (asset.uid() == null) {
                continue;
            }
            index.computeIfAbsent(asset.type(), t -> new java.util.HashMap<>()).put(asset.uid(), asset.uuid());
        }
        return index;
    }

    /** Variant {@code format} ("jpeg") → file extension ("jpg"); mirrors the ASSETS copy stage. */
    private static String extensionForFormat(String format) {
        if (format == null || format.isBlank()) {
            return "bin";
        }
        String value = format.toLowerCase(Locale.ROOT);
        return "jpeg".equals(value) ? "jpg" : value;
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
