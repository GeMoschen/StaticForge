package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.PlanInsight;
import com.acme.staticforge.generate.PlannedBuild;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.insight.RebuildEdgeKind;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.generate.insight.RunPlanStore;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Stored run plans (M22.1.2): a run's plan and reasons are stored right after PLAN, normalized, read back exactly as
 * planned, kept for the newest runs only, and deleted with their run.
 */
@SpringBootTest
@ActiveProfiles("test")
class RunPlanPersistenceIntegrationTest {

    private static final int RETENTION = 3;

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m22-plans-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
        registry.add("sf.generate.plan-retention-runs", () -> RETENTION);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationRunRepository runRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired RunPlanStore runPlanStore;
    @Autowired JdbcTemplate jdbc;

    private BuildInsightFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures, outputRoot);
    }

    private GenerationRequest request(GenerationTarget target, GenerationMode mode) {
        return new GenerationRequest(mode, null, List.of("html"), target.getId(), null, null, null, null);
    }

    private List<PlanEntryRecord> stored(GenerationRun run) {
        return runPlanStore.entries(run.getId(), PlanEntryRecord.Filter.NONE, Pageable.unpaged()).getContent();
    }

    private int rows(String table, GenerationRun run) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE run_id = ?", Integer.class, run.getId());
        return count == null ? 0 : count;
    }

    @Test
    void aRunStoresItsPlanNormalizedAndReadsItBackAsPlanned() {
        Fixture fx = fixtures.project("m22store");
        TemplateView shared = fixtures.pageTemplate(fx, "Shared", "", "<p>shared</p>");
        List<AssetVersionView> pages = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            pages.add(fixtures.page(fx, "Page " + i, shared.uuid()));
        }
        GenerationTarget target = fixtures.target(fx, "site", TargetType.FILESYSTEM);
        GenerationRun full = fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.FULL));
        assertThat(stored(full)).hasSize(100).allSatisfy(entry ->
                assertThat(entry.reason().rootKind()).isEqualTo(RebuildRootKind.FULL_BUILD));
        assertThat(rows("generation_run_plan_node", full)).isZero();

        fixtures.updateTemplate(fx, shared.uuid(), "<p>shared v2</p>", "{displayNameSlug}.{ext}");
        releaseFixtures.releaseAll(fx.project().getKey());
        PlannedBuild dryRun = generationService.planFor(fx.project().getKey(), request(target, GenerationMode.INCREMENTAL));
        List<PlanEntryRecord> planned = PlanInsight.entries(dryRun);
        GenerationRun incremental = fixtures.succeeded(fixtures.generate(fx, request(target, GenerationMode.INCREMENTAL)));

        assertThat(stored(incremental)).isEqualTo(planned);
        assertThat(stored(incremental).get(0).reason().steps()).extracting(step -> step.edge())
                .containsExactly(RebuildEdgeKind.PAGE_TEMPLATE);
        assertThat(rows("generation_run_plan_entry", incremental)).isEqualTo(100);
        assertThat(rows("generation_run_plan_node", incremental)).as("100 page nodes share one template root").isEqualTo(101);

        JsonNode summary = incremental.getPlanSummary();
        assertThat(summary.path("entryCount").asInt()).isEqualTo(100);
        assertThat(summary.path("byRootKind").path("ASSET_CHANGED").asInt()).isEqualTo(100);
        assertThat(summary.path("byFirstEdge").path("PAGE_TEMPLATE").asInt()).isEqualTo(100);
        assertThat(summary.path("byChannel").path("html").asInt()).isEqualTo(100);
        assertThat(summary.path("baselineRevision").asLong()).isEqualTo(full.getRevisionId());
        assertThat(summary.path("changedAssets").get(0).path("uuid").asText()).isEqualTo(shared.uuid().toString());
        assertThat(summary.path("via").get(0).path("count").asInt()).isEqualTo(100);

        Page<PlanEntryRecord> filtered = runPlanStore.entries(incremental.getId(),
                new PlanEntryRecord.Filter(RebuildRootKind.ASSET_CHANGED, "html", null, "page 1"), PageRequest.of(1, 5));
        assertThat(filtered.getTotalElements()).as("Page 1, Page 10–19").isEqualTo(11);
        assertThat(filtered.getContent()).hasSize(5);
        assertThat(runPlanStore.reasonFor(incremental.getId(), pages.get(7).uuid(), "html"))
                .hasValueSatisfying(reason -> assertThat(reason.rootUuid()).isEqualTo(shared.uuid()));
    }

    @Test
    void aRunFailingAfterPlanStillHasItsPlan() {
        Fixture fx = fixtures.project("m22failed");
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        AssetVersionView linked = fixtures.page(fx, "Linked", plain.uuid());
        TemplateView linking = fixtures.pageTemplate(fx, "Linking", "", "<a href=\"$CMS_REF(page:linked)$\">x</a>");
        fixtures.page(fx, "Linker", linking.uuid());
        GenerationTarget target = fixtures.target(fx, "site", TargetType.FILESYSTEM);
        // The literal page:linked no longer resolves: VALIDATE fails.
        assetService.changeUid(linked.uuid(), "renamed", fx.ctx());

        GenerationRun run = fixtures.generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).isEqualTo(RunStatus.FAILED);
        assertThat(run.getPlanSummary().path("entryCount").asInt()).isEqualTo(2);
        assertThat(stored(run)).hasSize(2);
    }

    @Test
    void onlyTheNewestPlansAreKeptAndPlansGoWithTheirRun() {
        Fixture fx = fixtures.project("m22retain");
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        fixtures.page(fx, "Home", plain.uuid());
        GenerationTarget target = fixtures.target(fx, "site", TargetType.FILESYSTEM);
        List<GenerationRun> runs = new ArrayList<>();
        for (int i = 0; i < RETENTION + 2; i++) {
            runs.add(fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.FULL)));
        }

        List<GenerationRun> reloaded = runs.stream().map(run -> runRepository.findById(run.getId()).orElseThrow()).toList();
        assertThat(reloaded).extracting(run -> RunPlanStore.available(run.getPlanSummary()))
                .containsExactly(false, false, true, true, true);
        assertThat(rows("generation_run_plan_entry", reloaded.get(0))).isZero();
        assertThat(reloaded.get(0).getPlanSummary().path("entryCount").asInt()).as("the summary stays").isEqualTo(1);
        assertThat(rows("generation_run_plan_entry", reloaded.get(4))).isEqualTo(1);

        GenerationRun newest = reloaded.get(4);
        runRepository.deleteById(newest.getId());
        assertThat(rows("generation_run_plan_entry", newest)).as("cascade").isZero();
    }

    @Test
    void namesWrittenByANewerBuildReadAsUnknown() {
        Fixture fx = fixtures.project("m22unknown");
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        AssetVersionView home = fixtures.page(fx, "Home", plain.uuid());
        GenerationTarget target = fixtures.target(fx, "site", TargetType.FILESYSTEM);
        fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.FULL));
        fixtures.updateTemplate(fx, plain.uuid(), "<p>v2</p>", "{displayNameSlug}.{ext}");
        GenerationRun run = fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.INCREMENTAL));

        jdbc.update("UPDATE generation_run_plan_node SET edge_kind = 'LOCALE_VARIANT' WHERE run_id = ? AND asset_uuid = ?",
                run.getId(), home.uuid());
        jdbc.update("UPDATE generation_run_plan_entry SET root_kind = 'SOMETHING_NEW' WHERE run_id = ?", run.getId());
        assertThat(stored(run)).singleElement().satisfies(entry ->
                assertThat(entry.reason().rootKind()).isEqualTo(RebuildRootKind.UNKNOWN));

        jdbc.update("UPDATE generation_run_plan_entry SET root_kind = 'ASSET_CHANGED' WHERE run_id = ?", run.getId());
        assertThat(stored(run)).singleElement().satisfies(entry -> {
            assertThat(entry.reason().steps()).singleElement()
                    .satisfies(step -> assertThat(step.edge()).isEqualTo(RebuildEdgeKind.UNKNOWN));
            assertThat(entry.reason().rootUuid()).isEqualTo(plain.uuid());
        });
        assertThat(UUID.fromString(run.getPlanSummary().path("changedAssets").get(0).path("uuid").asText()))
                .isEqualTo(plain.uuid());
    }
}
