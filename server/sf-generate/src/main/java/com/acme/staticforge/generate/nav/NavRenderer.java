package com.acme.staticforge.generate.nav;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.structure.NavNode;
import com.acme.staticforge.structure.StructureSource;
import com.acme.staticforge.structure.StructureSourceParser;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.render.BlockResolver;
import com.acme.staticforge.template.render.Escaping;
import com.acme.staticforge.template.render.OctlRenderer;
import com.acme.staticforge.template.render.RenderContext;
import com.acme.staticforge.template.render.RenderResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/**
 * Renders a structure's per-channel template against a computed navigation (spec §17.1,
 * §17.2). Stateless and thread-safe; the only shared mutable state is a bounded cache of
 * compiled nav templates.
 *
 * <p>Each nav node is exposed to the render scope with the JSON shape
 * <pre>{ "label", "href", "active", "trail", "level", "children":[…], "page":{ "uid", "displayName", "uuid" } }</pre>
 * plus the sibling {@code level} integer. {@code $CMS_NAV_RECURSE(node)} re-enters the same
 * compiled channel template with {@code node.children} at {@code node.level + 1}, so recursive
 * navigation menus are bounded only by the navigation {@code depth} and the renderer's own
 * include/loop guard rails.
 */
@Service
public class NavRenderer {

    private static final int MAX_COMPILED_CACHE = 2000;

    private final OctlCompiler octlCompiler = new OctlCompiler();
    private final OctlRenderer renderer = new OctlRenderer();
    private final ChannelService channelService;
    private final NavigationBuilder navigationBuilder;
    private final StructureSourceParser sourceParser = new StructureSourceParser();
    private final ConcurrentHashMap<String, CompiledTemplate> compiledCache = new ConcurrentHashMap<>();

    public NavRenderer(ChannelService channelService, NavigationBuilder navigationBuilder) {
        this.channelService = channelService;
        this.navigationBuilder = navigationBuilder;
    }

    /** Result of rendering a navigation, plus diagnostics and touched asset UUIDs. */
    public record NavRenderResult(String output, List<Diagnostic> diagnostics, Set<UUID> dependencies) {

        public NavRenderResult {
            output = output == null ? "" : output;
            diagnostics = diagnostics == null ? List.of() : List.copyOf(diagnostics);
            dependencies = dependencies == null ? Set.of() : Set.copyOf(dependencies);
        }
    }

    /**
     * The entry point for {@code $CMS_NAV(structure:uid)}: resolves the structure asset from the
     * snapshot, parses its source, computes the navigation, compiles the structure channel
     * template and renders the top-level nodes at level 0.
     *
     * @param structureUid the original UID (for diagnostics); may be {@code null}
     */
    public NavRenderResult renderNav(
            Snapshot snapshot,
            UUID structureUuid,
            String structureUid,
            UUID activePageUuid,
            String channel,
            OutputPathResolver paths) {
        Set<UUID> deps = new LinkedHashSet<>();
        List<Diagnostic> diagnostics = new ArrayList<>();

        SnapshotAsset structure = structureUuid == null ? null : snapshot.assetByUuid(structureUuid);
        if (structure == null || structure.type() != AssetType.STRUCTURE) {
            if (structureUuid != null) {
                deps.add(structureUuid);
            }
            diagnostics.add(Diagnostic.warning(
                    GenerationDiagnosticCodes.GEN_CHANNEL_MISSING,
                    "Unknown structure '" + (structureUid == null ? "" : structureUid) + "'; navigation empty.",
                    0,
                    0));
            return new NavRenderResult("", diagnostics, deps);
        }

        StructureSource source = sourceParser.parse(structure.payload().path("sourceText").asText(""));
        NavigationBuilder.NavBuildResult built = navigationBuilder.build(snapshot, source, activePageUuid, paths, channel);
        diagnostics.addAll(built.diagnostics());

        CompiledTemplate compiled = compileChannel(structure, channel);
        if (compiled == null) {
            deps.add(structureUuid);
            diagnostics.add(Diagnostic.warning(
                    GenerationDiagnosticCodes.GEN_CHANNEL_MISSING,
                    "Structure '" + (structureUid == null ? "" : structureUid) + "' has no '" + channel
                            + "' channel template; navigation empty.",
                    0,
                    0));
            return new NavRenderResult("", diagnostics, deps);
        }

        deps.add(structureUuid);
        collectPageDeps(built.root(), deps);

        Escaping escaping = channelService == null
                ? Escaping.HTML
                : channelService.defaultEscaping(snapshot.projectId(), channel);

        Plan plan = new Plan(snapshot, channel, structureUuid, activePageUuid, paths, compiled, escaping, deps, diagnostics);
        String output = renderLevel(serialize(built.root().children()), 0, plan);

        return new NavRenderResult(output, diagnostics, deps);
    }

    // ------------------------------------------------------------------
    // Recursive rendering core
    // ------------------------------------------------------------------

    private String renderLevel(ArrayNode nodes, int level, Plan plan) {
        BlockResolver resolver = new BlockResolver() {
            @Override
            public String renderBody(String bodyName) {
                return "";
            }

            @Override
            public String renderInclude(String uid, Map<String, String> args) {
                return "";
            }

            @Override
            public String renderNav(String structureUid, Map<String, String> args) {
                UUID nested = resolveStructureByUid(plan.snapshot(), structureUid);
                if (nested == null) {
                    return "";
                }
                NavRenderResult result = NavRenderer.this.renderNav(
                        plan.snapshot(), nested, structureUid, plan.activePageUuid(), plan.channel(), plan.paths());
                plan.deps().addAll(result.dependencies());
                plan.diagnostics().addAll(result.diagnostics());
                return result.output();
            }

            @Override
            public String renderNavRecurse(JsonNode node) {
                JsonNode childrenNode = node.path("children");
                ArrayNode children = childrenNode != null && childrenNode.isArray()
                        ? (ArrayNode) childrenNode
                        : JsonNodeFactory.instance.arrayNode();
                int childLevel = node.path("level").asInt(level) + 1;
                return renderLevel(children, childLevel, plan);
            }
        };

        ObjectNode values = JsonNodeFactory.instance.objectNode();
        values.set("nodes", nodes != null ? nodes : JsonNodeFactory.instance.arrayNode());
        values.put("level", level);

        RenderContext context = RenderContext.builder()
                .channel(plan.channel())
                .escaping(plan.escaping())
                .values(values)
                .blockResolver(resolver)
                .build();

        RenderResult result = renderer.render(plan.compiled(), context);
        plan.deps().addAll(result.dependencies());
        plan.diagnostics().addAll(result.warnings());
        return result.output();
    }

    // ------------------------------------------------------------------
    // Compilation + serialization
    // ------------------------------------------------------------------

    private CompiledTemplate compileChannel(SnapshotAsset structure, String channel) {
        String cacheKey = structure.uuid() + ":" + channel;
        CompiledTemplate cached = compiledCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }
        JsonNode channelNode = structure.payload().path("channelTemplates").path(channel);
        if (channelNode.isMissingNode() || channelNode.isNull() || channelNode.path("source").asText().isBlank()) {
            return null;
        }
        OctlResult result = octlCompiler.compile(channelNode.path("source").asText(), channel, null);
        if (result.hasErrors()) {
            return null;
        }
        CompiledTemplate compiled = result.template();
        if (compiledCache.size() >= MAX_COMPILED_CACHE) {
            compiledCache.clear();
        }
        compiledCache.put(cacheKey, compiled);
        return compiled;
    }

    private ArrayNode serialize(List<NavNode> nodes) {
        ArrayNode array = JsonNodeFactory.instance.arrayNode();
        if (nodes == null) {
            return array;
        }
        for (NavNode node : nodes) {
            array.add(serialize(node));
        }
        return array;
    }

    private ObjectNode serialize(NavNode node) {
        ObjectNode json = JsonNodeFactory.instance.objectNode();
        json.put("label", node.label() == null ? "" : node.label());
        json.put("href", node.href() == null ? "" : node.href());
        json.put("active", node.active());
        json.put("trail", node.trail());
        json.put("level", node.level());
        json.set("children", serialize(node.children()));
        ObjectNode page = json.putObject("page");
        page.put("uid", node.pageUid() == null ? "" : node.pageUid());
        page.put("displayName", node.displayName() == null ? "" : node.displayName());
        page.put("uuid", node.pageUuid() == null ? "" : node.pageUuid().toString());
        return json;
    }

    private void collectPageDeps(NavNode node, Set<UUID> deps) {
        if (node.pageUuid() != null) {
            deps.add(node.pageUuid());
        }
        for (NavNode child : node.children()) {
            collectPageDeps(child, deps);
        }
    }

    private UUID resolveStructureByUid(Snapshot snapshot, String uid) {
        if (uid == null || uid.isBlank()) {
            return null;
        }
        for (SnapshotAsset asset : snapshot.assetsOfType(AssetType.STRUCTURE)) {
            if (uid.equals(asset.uid()) || uid.equals(asset.uuid().toString())) {
                return asset.uuid();
            }
        }
        return null;
    }

    /** Immutable render plan threaded through the recursive renders. */
    private record Plan(
            Snapshot snapshot,
            String channel,
            UUID structureUuid,
            UUID activePageUuid,
            OutputPathResolver paths,
            CompiledTemplate compiled,
            Escaping escaping,
            Set<UUID> deps,
            List<Diagnostic> diagnostics) {}
}
