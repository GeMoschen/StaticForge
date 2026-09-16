package com.acme.staticforge.generate.render;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.project.ProjectRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * `M16.1.1`: one generation build compiles each (template, channel) and each template's CDL
 * exactly once — across the orchestrator's validate call, the pipeline's own validate pass and
 * the parallel render of every page and section instance.
 */
class RenderPipelineCompileCacheTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int PAGES = 50;

    private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
    private final CompiledTemplateCache cache = new CompiledTemplateCache(meters, 2000, Duration.ofMinutes(30));
    private final List<SnapshotAsset> assets = new ArrayList<>();

    @Test
    void fiftyPagesSharingOnePageTemplateAndTwoSectionTemplatesCompileThreeTimesEach() {
        UUID pageTemplate = template(
                AssetType.PAGE_TEMPLATE,
                "page_tpl",
                "content { editor text title { label \"Title\" } } bodies { body main { label \"Main\" allow [\"*\"] } }",
                "<h1>$CMS_VALUE(title)$</h1>$CMS_BODY(main)$");
        UUID teaser = template(
                AssetType.SECTION_TEMPLATE, "teaser", "content { editor text text { label \"Text\" } }",
                "<p>$CMS_VALUE(text)$</p>");
        UUID quote = template(
                AssetType.SECTION_TEMPLATE, "quote", "content { editor text text { label \"Text\" } }",
                "<q>$CMS_VALUE(text)$</q>");
        List<PlanEntry> entries = new ArrayList<>();
        for (int i = 0; i < PAGES; i++) {
            ObjectNode payload = MAPPER.createObjectNode();
            payload.put("templateRef", pageTemplate.toString());
            payload.putObject("content").put("title", "Page " + i);
            ArrayNode main = payload.putObject("bodies").putArray("main");
            section(main, teaser, "t" + i);
            section(main, quote, "q" + i);
            section(main, teaser, "t2-" + i);
            UUID page = add(AssetType.PAGE, "page" + i, payload);
            entries.add(new PlanEntry(page, "html", "page" + i + ".html"));
        }
        Snapshot snapshot = snapshot();
        BuildPlan plan = new BuildPlan(false, 1L, entries, Set.of());
        RenderPipeline pipeline = new RenderPipeline(
                new GenerationProperties(), mock(ProjectRepository.class), null, new SimpleMeterRegistry(), null, cache);

        // GenerationService validates first, then executes (which validates again).
        assertThat(pipeline.validate(snapshot, plan)).isEmpty();
        RenderOutcome outcome =
                pipeline.execute(snapshot, plan, OutputPathResolver.forSnapshot(snapshot, Map.of()));

        assertThat(outcome.errors()).isEmpty();
        assertThat(outcome.files()).hasSize(PAGES);
        assertThat(new String(outcome.files().get(0).bytes(), StandardCharsets.UTF_8))
                .isEqualTo("<h1>Page 0</h1><p>t0</p><q>q0</q><p>t2-0</p>");
        assertThat(compiles("octl")).isEqualTo(3);
        assertThat(compiles("cdl")).isEqualTo(3);

        // A second build (a new snapshot object) gets its own memo.
        Snapshot nextBuild = snapshot();
        pipeline.execute(nextBuild, plan, OutputPathResolver.forSnapshot(nextBuild, Map.of()));
        assertThat(compiles("octl")).isEqualTo(6);
        assertThat(outcome.files()).extracting(RenderedFile::outputPath).contains("page49.html");
    }

    private double compiles(String kind) {
        return meters.get("sf.template.compiles").tag("kind", kind).counter().count();
    }

    private static void section(ArrayNode body, UUID template, String text) {
        ObjectNode instance = body.addObject();
        instance.put("instanceId", text);
        instance.put("templateRef", template.toString());
        instance.putObject("content").put("text", text);
    }

    private UUID template(AssetType type, String uid, String cdl, String html) {
        ObjectNode payload = MAPPER.createObjectNode();
        payload.put("contentDefinition", cdl);
        payload.putObject("channelTemplates").putObject("html").put("source", html);
        return add(type, uid, payload);
    }

    private UUID add(AssetType type, String uid, ObjectNode payload) {
        UUID uuid = UUID.nameUUIDFromBytes((type + ":" + uid).getBytes(StandardCharsets.UTF_8));
        assets.add(new SnapshotAsset(uuid, assets.size() + 1L, type, uid, uid, "/", payload, false));
        return uuid;
    }

    private Snapshot snapshot() {
        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        Map<Long, SnapshotAsset> byId = new HashMap<>();
        for (SnapshotAsset asset : assets) {
            byUuid.put(asset.uuid(), asset);
            byId.put(asset.assetId(), asset);
        }
        return new Snapshot(1L, 1L, byUuid, byId);
    }
}
