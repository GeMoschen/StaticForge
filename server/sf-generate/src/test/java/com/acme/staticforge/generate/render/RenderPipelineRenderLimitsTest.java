package com.acme.staticforge.generate.render;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * `M16.5.1`: render guard rails span the nested section/include/catalog renders of one page in
 * generation. A limit hit fails only that page's file (reported in the outcome's errors, which
 * become the run diagnostics); every other page in the plan still renders.
 */
class RenderPipelineRenderLimitsTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final List<SnapshotAsset> assets = new ArrayList<>();
    private final List<PlanEntry> entries = new ArrayList<>();

    @Test
    void includeCycleFailsOnlyTheAffectedPageWith0135() {
        UUID plain = pageTemplate("plain", "", "<p>fine</p>");
        UUID cyclic = pageTemplate("cyclic", "", "$CMS_INCLUDE(section_template:a)$");
        sectionTemplate("a", "", "A[$CMS_INCLUDE(section_template:b)$]");
        sectionTemplate("b", "", "B[$CMS_INCLUDE(section_template:a)$]");
        page("ok", plain, MAPPER.createObjectNode());
        page("broken", cyclic, MAPPER.createObjectNode());

        RenderOutcome outcome = execute();

        assertThat(outcome.errors()).singleElement().satisfies(error -> {
            assertThat(error.code()).isEqualTo(DiagnosticCodes.OCTL_INCLUDE_CYCLE);
            assertThat(error.message()).isEqualTo("Include cycle: a → b → a");
        });
        assertThat(outcome.files()).extracting(RenderedFile::outputPath).containsExactly("ok.html");
        assertThat(text(outcome.files().get(0))).isEqualTo("<p>fine</p>");
    }

    @Test
    void catalogCardWhoseTemplateRendersACatalogOfItselfFailsWith0135() {
        String catalogCdl = "content { editor catalog related { label \"Related\" } }";
        UUID pageTpl = pageTemplate("with_cards", catalogCdl, "$CMS_VALUE(related)$");
        UUID card = sectionTemplate("card", catalogCdl, "card[$CMS_VALUE(related)$]");
        ObjectNode innerCardContent = MAPPER.createObjectNode();
        innerCardContent.set("related", catalog(card, MAPPER.createObjectNode()));
        ObjectNode pageContent = MAPPER.createObjectNode();
        pageContent.set("related", catalog(card, innerCardContent));
        page("cards", pageTpl, pageContent);

        RenderOutcome outcome = execute();

        assertThat(outcome.errors()).extracting(Diagnostic::code).containsExactly(DiagnosticCodes.OCTL_INCLUDE_CYCLE);
        assertThat(outcome.errors().get(0).message()).isEqualTo("Include cycle: card → card");
        assertThat(outcome.files()).isEmpty();
    }

    @Test
    void nonCyclicIncludeChainDeeperThan32LevelsFailsWith0130() {
        UUID shallow = pageTemplate("shallow", "", "$CMS_INCLUDE(section_template:s0)$");
        UUID deep = pageTemplate("deep", "", "$CMS_INCLUDE(section_template:d0)$");
        chain("s", 32);
        chain("d", 33);
        page("shallow_page", shallow, MAPPER.createObjectNode());
        page("deep_page", deep, MAPPER.createObjectNode());

        RenderOutcome outcome = execute();

        assertThat(outcome.errors()).extracting(Diagnostic::code).containsExactly(DiagnosticCodes.OCTL_INCLUDE_DEPTH);
        assertThat(outcome.files()).extracting(RenderedFile::outputPath).containsExactly("shallow_page.html");
        assertThat(text(outcome.files().get(0))).startsWith("[s0][s1]").endsWith("[s31]");
    }

    @Test
    void loopIterationsAggregateAcrossTheSectionsOfOnePage() {
        String loop = "$CMS_FOR(i : CMS_PAGE.items)$$CMS_END_FOR$";
        UUID once = pageTemplate("once", "", "$CMS_INCLUDE(section_template:loop_a)$");
        UUID twice = pageTemplate(
                "twice",
                "",
                "$CMS_INCLUDE(section_template:loop_a)$$CMS_INCLUDE(section_template:loop_b)$");
        sectionTemplate("loop_a", "", loop);
        sectionTemplate("loop_b", "", loop);
        ObjectNode content = MAPPER.createObjectNode();
        ArrayNode items = content.putArray("items");
        for (int i = 0; i < 60_000; i++) {
            items.add(i);
        }
        page("once_page", once, content);
        page("twice_page", twice, content);

        RenderOutcome outcome = execute();

        assertThat(outcome.errors()).extracting(Diagnostic::code).containsExactly(DiagnosticCodes.OCTL_LOOP_LIMIT);
        assertThat(outcome.files()).extracting(RenderedFile::outputPath).containsExactly("once_page.html");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private RenderOutcome execute() {
        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        Map<Long, SnapshotAsset> byId = new HashMap<>();
        for (SnapshotAsset asset : assets) {
            byUuid.put(asset.uuid(), asset);
            byId.put(asset.assetId(), asset);
        }
        Snapshot snapshot = new Snapshot(1L, 1L, byUuid, byId);
        RenderPipeline pipeline = new RenderPipeline(
                new GenerationProperties(), mock(ProjectRepository.class), null, new SimpleMeterRegistry(), null);
        return pipeline.execute(
                snapshot,
                new BuildPlan(false, 1L, entries, Set.of()),
                OutputPathResolver.forSnapshot(snapshot, "index", false, "RELATIVE"));
    }

    /** {@code <prefix>0} includes {@code <prefix>1} … up to {@code <prefix><levels - 1>}: {@code levels} section templates. */
    private void chain(String prefix, int levels) {
        for (int i = 0; i < levels; i++) {
            String next = i + 1 < levels ? "$CMS_INCLUDE(section_template:" + prefix + (i + 1) + ")$" : "";
            sectionTemplate(prefix + i, "", "[" + prefix + i + "]" + next);
        }
    }

    private UUID pageTemplate(String uid, String cdl, String htmlSource) {
        return template(AssetType.PAGE_TEMPLATE, uid, cdl, htmlSource);
    }

    private UUID sectionTemplate(String uid, String cdl, String htmlSource) {
        return template(AssetType.SECTION_TEMPLATE, uid, cdl, htmlSource);
    }

    private UUID template(AssetType type, String uid, String cdl, String htmlSource) {
        ObjectNode payload = MAPPER.createObjectNode();
        payload.put("contentDefinition", cdl);
        payload.putObject("channelTemplates").putObject("html").put("source", htmlSource);
        return add(type, uid, payload);
    }

    private void page(String uid, UUID templateUuid, JsonNode content) {
        ObjectNode payload = MAPPER.createObjectNode();
        payload.put("templateRef", templateUuid.toString());
        payload.set("content", content);
        UUID uuid = add(AssetType.PAGE, uid, payload);
        entries.add(new PlanEntry(uuid, "html", uid + ".html"));
    }

    private UUID add(AssetType type, String uid, JsonNode payload) {
        UUID uuid = UUID.nameUUIDFromBytes((type + ":" + uid).getBytes(StandardCharsets.UTF_8));
        assets.add(new SnapshotAsset(uuid, assets.size() + 1L, type, uid, uid, "/", payload, false));
        return uuid;
    }

    private static ObjectNode catalog(UUID cardTemplate, JsonNode cardContent) {
        ObjectNode value = MAPPER.createObjectNode().put("type", "CATALOG");
        ObjectNode card = value.putArray("cards").addObject();
        card.put("instanceId", UUID.nameUUIDFromBytes(cardContent.toString().getBytes(StandardCharsets.UTF_8)).toString());
        card.put("templateRef", cardTemplate.toString());
        card.set("content", cardContent);
        return value;
    }

    private static String text(RenderedFile file) {
        return new String(file.bytes(), StandardCharsets.UTF_8);
    }
}
