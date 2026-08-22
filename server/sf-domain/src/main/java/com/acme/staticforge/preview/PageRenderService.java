package com.acme.staticforge.preview;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.template.render.BlockResolver;
import com.acme.staticforge.template.render.Escaping;
import com.acme.staticforge.template.render.OctlRenderer;
import com.acme.staticforge.template.render.RenderContext;
import com.acme.staticforge.template.render.Renderer;
import com.acme.staticforge.template.render.UrlResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Full page/section preview renderer (spec §19). Reuses the exact M2 render engine — the
 * {@link OctlCompiler} and {@link Renderer} (an {@link OctlRenderer}) — so preview and
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

    private final OctlCompiler octlCompiler = new OctlCompiler();
    private final CdlCompiler cdlCompiler = new CdlCompiler();
    private final Renderer renderer = new OctlRenderer();

    public PageRenderService(
            AssetService assetService,
            AssetRepository assetRepository,
            ProjectRepository projectRepository,
            ObjectMapper objectMapper) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.projectRepository = projectRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * Renders a saved page at its current revision.
     *
     * @param pageUuid the page asset UUID
     * @param revision optional revision to render (latest when {@code null})
     * @param channel the channel key (for example {@code "html"})
     * @param rewriteLinks whether {@code $CMS_REF} targets are rewritten to preview URLs
     */
    public String renderPage(UUID pageUuid, Long revision, String channel, boolean rewriteLinks) {
        return renderPage(pageUuid, revision, channel, rewriteLinks, null);
    }

    /**
     * Renders a saved page, rewriting links against an explicit API base when
     * {@code rewriteLinks} is {@code true}.
     *
     * @param baseUrl the API base (for example {@code http://host/api/v1}); required for link
     *                rewriting, may be {@code null} otherwise
     */
    public String renderPage(UUID pageUuid, Long revision, String channel, boolean rewriteLinks, String baseUrl) {
        return doRender(pageUuid, revision, channel, rewriteLinks, baseUrl, null);
    }

    /**
     * Renders an unsaved (live) page payload that is never persisted (spec §19.1).
     *
     * @param unsavedPayload the payload carrying {@code content} and {@code bodies}
     * @param pageTemplateUuid the page template to render against
     * @param channel the channel key
     * @param rewriteLinks whether {@code $CMS_REF} targets are rewritten to preview URLs
     */
    public String renderLive(JsonNode unsavedPayload, UUID pageTemplateUuid, String channel, boolean rewriteLinks) {
        return renderLive(unsavedPayload, pageTemplateUuid, channel, rewriteLinks, null);
    }

    /** {@code renderLive} variant taking an explicit API base for link rewriting. */
    public String renderLive(
            JsonNode unsavedPayload, UUID pageTemplateUuid, String channel, boolean rewriteLinks, String baseUrl) {
        return doRender(pageTemplateUuid, unsavedPayload, channel, rewriteLinks, baseUrl);
    }

    /**
     * Renders a section template alone against sample content (spec §19.1).
     *
     * @param sectionTemplateUuid the section template UUID
     * @param sampleContent editor values to feed the section template
     * @param channel the channel key
     */
    public String renderSection(UUID sectionTemplateUuid, JsonNode sampleContent, String channel) {
        long projectId = projectIdOf(sectionTemplateUuid);
        return renderSectionTemplate(
                projectId, projectKeyOf(projectId), sectionTemplateUuid, null, null, sampleContent, null, channel, false, null);
    }

    // ------------------------------------------------------------------
    // Saved + live entry points
    // ------------------------------------------------------------------

    private String doRender(
            UUID pageUuid, Long revision, String channel, boolean rewriteLinks, String baseUrl, JsonNode livePayload) {
        long projectId = projectIdOf(pageUuid);
        String projectKey = projectKeyOf(projectId);

        PageView page;
        if (livePayload != null) {
            page = PageView.fromLivePayload(pageUuid, livePayload);
        } else if (revision == null) {
            page = PageView.from(assetService.requireCurrent(pageUuid));
        } else {
            AssetVersionView view = assetService
                    .findAt(pageUuid, revision)
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Page not found at revision " + revision + ".")));
            page = PageView.from(view);
        }
        return renderPage(projectId, projectKey, page, channel, rewriteLinks, baseUrl);
    }

    private String doRender(UUID pageTemplateUuid, JsonNode unsavedPayload, String channel, boolean rewriteLinks, String baseUrl) {
        long projectId = projectIdOf(pageTemplateUuid);
        String projectKey = projectKeyOf(projectId);
        PageView page = PageView.fromLivePayload(pageTemplateUuid, unsavedPayload);
        return renderPage(projectId, projectKey, page, channel, rewriteLinks, baseUrl);
    }

    // ------------------------------------------------------------------
    // Core render
    // ------------------------------------------------------------------

    private String renderPage(
            long projectId, String projectKey, PageView page, String channel, boolean rewriteLinks, String baseUrl) {
        AssetVersionView pageTemplate = assetService.requireCurrent(page.pageTemplateUuid());
        CompiledTemplate compiled = compilePageChannel(pageTemplate.payload(), channel, projectId);
        if (compiled == null) {
            return ""; // missing channel template degrades gracefully to an empty body
        }

        UrlResolver urlResolver = urlResolver(projectKey, rewriteLinks, baseUrl);
        BlockResolver blocks = blockResolver(projectId, projectKey, page, channel, rewriteLinks, baseUrl);

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
                .build();

        return renderer.render(compiled, context).output();
    }

    private CompiledTemplate compilePageChannel(JsonNode templatePayload, String channel, long projectId) {
        return compileChannel(templatePayload, channel, projectId);
    }

    private CompiledTemplate compileChannel(JsonNode templatePayload, String channel, long projectId) {
        if (templatePayload == null) {
            return null;
        }
        JsonNode channelNode = templatePayload.path("channelTemplates").path(channel);
        if (channelNode.isMissingNode() || channelNode.isNull()) {
            return null;
        }
        String source = channelNode.path("source").asText();
        ContentDefinition definition = cdlCompiler
                .compile(templatePayload.path("contentDefinition").asText(""))
                .definition();
        OctlResult result = octlCompiler.compile(source, channel, referenceResolver(projectId), definition);
        return result.template();
    }

    // ------------------------------------------------------------------
    // Block resolver: bodies + includes
    // ------------------------------------------------------------------

    private BlockResolver blockResolver(
            long projectId, String projectKey, PageView page, String channel, boolean rewriteLinks, String baseUrl) {
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
                            projectId, projectKey, page.content(), section, channel, rewriteLinks, baseUrl));
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
                        projectId, projectKey, uuid, null, null, objectMapper.createObjectNode(), null, channel, rewriteLinks, baseUrl);
            }

            @Override
            public String renderNav(String structureUid, Map<String, String> args) {
                return ""; // navigation is a later milestone (§17)
            }
        };
    }

    private String renderSectionInstance(
            long projectId,
            String projectKey,
            JsonNode pageContent,
            JsonNode section,
            String channel,
            boolean rewriteLinks,
            String baseUrl) {
        String templateRef = section.path("templateRef").asText();
        if (templateRef.isBlank()) {
            return "";
        }
        UUID sectionTemplateUuid = UUID.fromString(templateRef);
        JsonNode content = section.path("content");
        String instanceId = section.path("instanceId").asText();
        return renderSectionTemplate(
                projectId, projectKey, sectionTemplateUuid, null, instanceId,
                content, pageContent, channel, rewriteLinks, baseUrl);
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
            String baseUrl) {
        AssetVersionView template = assetService.requireCurrent(sectionTemplateUuid);
        CompiledTemplate compiled = compileChannel(template.payload(), channel, projectId);
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
                .urlResolver(urlResolver(projectKey, rewriteLinks, baseUrl))
                .blockResolver(blockResolver(
                        projectId, projectKey, PageView.contextOnly(pageValues), channel, rewriteLinks, baseUrl));
        if (instanceId != null && !instanceId.isBlank()) {
            builder.meta("instanceId", TextNode.valueOf(instanceId));
        }
        return renderer.render(compiled, builder.build()).output();
    }

    // ------------------------------------------------------------------
    // Resolvers
    // ------------------------------------------------------------------

    private ReferenceResolver referenceResolver(long projectId) {
        return (assetType, uid) -> {
            AssetType type;
            try {
                type = AssetType.valueOf(assetType.toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException | NullPointerException e) {
                return Optional.empty();
            }
            return assetRepository.findByProjectIdAndAssetTypeAndUid(projectId, type, uid).map(Asset::getUuid);
        };
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

    private UrlResolver urlResolver(String projectKey, boolean rewriteLinks, String baseUrl) {
        if (!rewriteLinks) {
            return (kind, uid, uuid, args) -> uid != null && !uid.isBlank() ? uid : (uuid == null ? "" : uuid.toString());
        }
        String base = baseUrl == null ? "" : baseUrl;
        return (kind, uid, uuid, args) -> {
            String target = uuid == null ? "" : uuid.toString();
            if ("media".equals(kind)) {
                String variant = args == null ? null : args.get("variant");
                String query = variant == null || variant.isBlank() ? "" : "?variant=" + variant;
                return base + "/projects/" + projectKey + "/media/" + target + "/binary" + query;
            }
            return base + "/projects/" + projectKey + "/preview/pages/" + target;
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

    private long projectIdOf(UUID uuid) {
        return assetRepository
                .findByUuid(uuid)
                .map(Asset::getProjectId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")));
    }

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

        static PageView fromLivePayload(UUID pageTemplateUuid, JsonNode payload) {
            return new PageView(
                    null, "", "", "", "", pageTemplateUuid,
                    payload == null ? null : payload.get("content"),
                    payload == null ? null : payload.get("bodies"));
        }

        static PageView contextOnly(JsonNode pageContent) {
            return new PageView(null, "", "", "", "", null, pageContent, null);
        }
    }
}
