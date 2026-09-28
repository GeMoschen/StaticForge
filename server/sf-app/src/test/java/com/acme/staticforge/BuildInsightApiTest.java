package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.insight.RunPlanStore;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Build insight over REST (M22.2.1, M22.2.2): the dry run, a run's stored plan and asset impact.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BuildInsightApiTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m22-api-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
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

    /** Two pages linking a media file directly, one placing a teaser section, one plain page. */
    private record Site(
            Fixture fx, String token, GenerationTarget target, AssetVersionView hero, AssetVersionView unused,
            TemplateView teaser, List<AssetVersionView> heroPages, AssetVersionView home, AssetVersionView legal) {}

    private Site site(String prefix) {
        Fixture fx = fixtures.project(prefix);
        AssetVersionView hero = fixtures.media(fx, "hero.txt", "HERO");
        AssetVersionView unused = fixtures.media(fx, "unused.txt", "UNUSED");
        TemplateView teaser = fixtures.sectionTemplate(fx, "Teaser", "", "<p>teaser</p>");
        TemplateView article = fixtures.pageTemplate(fx, "Article",
                "bodies { body main { label \"Main\" allow [\"*\"] } }", "<main>$CMS_BODY(main)$</main>");
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        List<AssetVersionView> heroPages = List.of(
                fixtures.page(fx, "About", plain.uuid(), p -> p.withObject("content").set("hero", fixtures.mediaRef(hero.uuid()))),
                fixtures.page(fx, "Team", plain.uuid(), p -> p.withObject("content").set("hero", fixtures.mediaRef(hero.uuid()))));
        AssetVersionView home = fixtures.page(fx, "Home", article.uuid(), p -> fixtures.section(p, "main", teaser.uuid()));
        AssetVersionView legal = fixtures.page(fx, "Legal", plain.uuid());
        GenerationTarget target = fixtures.target(fx, "site", TargetType.FILESYSTEM);
        releaseFixtures.releaseAll(fx.projectId());
        return new Site(fx, jwtService.issueAccessToken(fx.user()), target, hero, unused, teaser, heroPages, home, legal);
    }

    private String base(Fixture fx) {
        return "/api/v1/projects/" + fx.project().getKey();
    }

    private String request(GenerationTarget target, String mode) {
        return "{\"mode\":\"" + mode + "\",\"channels\":[\"html\"],\"targetId\":" + target.getId() + "}";
    }

    /** Releases what is pending first (M27.2.1): a plan is what a run started now would build. */
    private ResultActions dryRun(Site site, String token, String mode, String query) throws Exception {
        releaseFixtures.releaseAll(site.fx().projectId());
        return mvc.perform(post(base(site.fx()) + "/generations/plan" + query)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(request(site.target(), mode)));
    }

    private ResultActions getJson(String token, String url) throws Exception {
        return mvc.perform(get(url).header("Authorization", "Bearer " + token));
    }

    private JsonNode body(ResultActions result) throws Exception {
        return fixtures.json(result.andReturn().getResponse().getContentAsString());
    }

    private GenerationRun startAndAwait(Site site, String mode) throws Exception {
        releaseFixtures.releaseAll(site.fx().projectId());
        JsonNode started = body(mvc.perform(post(base(site.fx()) + "/generations")
                        .header("Authorization", "Bearer " + site.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(site.target(), mode)))
                .andExpect(status().isAccepted()));
        return fixtures.succeeded(fixtures.await(site.fx(), started.path("id").asLong()));
    }

    private int count(String table) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
        return count == null ? 0 : count;
    }

    private static Set<String> outputs(JsonNode entries) {
        return StreamSupport.stream(entries.path("content").spliterator(), false)
                .map(entry -> entry.path("assetUuid").asText() + "|" + entry.path("channel").asText() + "|"
                        + entry.path("outputPath").asText())
                .collect(Collectors.toSet());
    }

    @Test
    void aRunKeepsTheCommentItWasStartedWith() throws Exception {
        Site site = site("bi-comment");
        releaseFixtures.releaseAll(site.fx().projectId());
        JsonNode started = start(site, "{\"mode\":\"FULL\",\"targetId\":" + site.target().getId()
                + ",\"comment\":\"  Hotfix for the footer  \"}");
        assertThat(started.path("comment").asText()).isEqualTo("Hotfix for the footer");
        fixtures.succeeded(fixtures.await(site.fx(), started.path("id").asLong()));
        JsonNode read = body(mvc.perform(get(base(site.fx()) + "/generations/" + started.path("id").asLong())
                        .header("Authorization", "Bearer " + site.token()))
                .andExpect(status().isOk()));
        assertThat(read.path("comment").asText()).isEqualTo("Hotfix for the footer");
        JsonNode history = body(mvc.perform(get(base(site.fx()) + "/generations").header("Authorization", "Bearer " + site.token()))
                .andExpect(status().isOk()));
        assertThat(history.get(0).path("comment").asText()).isEqualTo("Hotfix for the footer");

        // A blank note is no note; a long one keeps its first 500 characters, like a revision comment.
        JsonNode blank = start(site, "{\"mode\":\"FULL\",\"targetId\":" + site.target().getId() + ",\"comment\":\"   \"}");
        assertThat(blank.has("comment")).isTrue();
        assertThat(blank.get("comment").isNull()).isTrue();
        fixtures.succeeded(fixtures.await(site.fx(), blank.path("id").asLong()));
        JsonNode longer = start(site, "{\"mode\":\"FULL\",\"targetId\":" + site.target().getId()
                + ",\"comment\":\"" + "x".repeat(600) + "\"}");
        assertThat(longer.path("comment").asText()).hasSize(500).endsWith("…");
        fixtures.succeeded(fixtures.await(site.fx(), longer.path("id").asLong()));
    }

    /**
     * Redirect detection in the plan views (M30.4.2): the dry run lists the redirects a run would add and counts them;
     * the run's summary counts what it added and emitted; a stored plan lists no candidates.
     */
    @Test
    void thePlanViewsCarryTheDetectedRedirects() throws Exception {
        Site site = site("bi-redirect");
        startAndAwait(site, "FULL");
        fixtures.rename(site.fx(), site.legal().uuid(), "Imprint");

        JsonNode plan = body(dryRun(site, site.token(), "INCREMENTAL", "").andExpect(status().isOk()));
        assertThat(plan.path("redirectCandidates")).singleElement().satisfies(candidate -> {
            assertThat(candidate.path("channel").asText()).isEqualTo("html");
            assertThat(candidate.path("locale").asText()).isEmpty();
            assertThat(candidate.path("fromPath").asText()).isEqualTo("legal.html");
            assertThat(candidate.path("toAssetUuid").asText()).isEqualTo(site.legal().uuid().toString());
            assertThat(candidate.path("toPageNumber").asInt()).isEqualTo(1);
            assertThat(candidate.path("toPath").asText()).isEqualTo("imprint.html");
        });
        assertThat(plan.path("summary").path("redirectsAdded").asInt()).isEqualTo(1);
        assertThat(plan.path("summary").path("redirectsActive").isNull()).isTrue();

        GenerationRun run = startAndAwait(site, "INCREMENTAL");
        JsonNode view = body(getJson(site.token(), base(site.fx()) + "/generations/" + run.getId()).andExpect(status().isOk()));
        assertThat(view.path("planSummary").path("redirectsAdded").asInt()).isEqualTo(1);
        assertThat(view.path("planSummary").path("redirectsActive").asInt()).isEqualTo(1);
        JsonNode stored = body(getJson(site.token(), base(site.fx()) + "/generations/" + run.getId() + "/plan")
                .andExpect(status().isOk()));
        assertThat(stored.path("summary").path("redirectsAdded").asInt()).isEqualTo(1);
        assertThat(stored.path("redirectCandidates").isNull()).isTrue();
    }

    /** Starts a run; the body is read as UTF-8, so a comment's "…" stays one character. */
    private JsonNode start(Site site, String body) throws Exception {
        return fixtures.json(mvc.perform(post(base(site.fx()) + "/generations")
                        .header("Authorization", "Bearer " + site.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isAccepted())
                .andReturn()
                .getResponse()
                .getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
    }

    @Test
    void theDryRunPlansExactlyWhatTheRunStartedAfterItBuilds() throws Exception {
        Site site = site("m22dry");
        startAndAwait(site, "FULL");
        fixtures.rename(site.fx(), site.hero().uuid(), "Hero image");
        fixtures.updateTemplate(site.fx(), site.teaser().uuid(), "<p>teaser v2</p>", null);

        JsonNode dryRun = body(dryRun(site, site.token(), "INCREMENTAL", "?size=500").andExpect(status().isOk()));
        assertThat(dryRun.path("runId").isNull()).isTrue();
        assertThat(dryRun.path("target").path("name").asText()).isEqualTo("site");
        assertThat(dryRun.path("summary").path("incremental").asBoolean()).isTrue();
        assertThat(dryRun.path("summary").path("entryCount").asInt()).isEqualTo(3);
        assertThat(dryRun.path("changedAssets")).hasSize(2);
        JsonNode about = StreamSupport.stream(dryRun.path("entries").path("content").spliterator(), false)
                .filter(entry -> entry.path("uid").asText().equals("about"))
                .findFirst()
                .orElseThrow();
        assertThat(about.path("reason").path("rootKind").asText()).isEqualTo("ASSET_RELEASED");
        assertThat(about.path("reason").path("rootAsset").path("uid").asText()).isEqualTo("hero_txt");
        assertThat(about.path("reason").path("steps").get(0).path("referenceKind").asText()).isEqualTo("MEDIA_REF");

        GenerationRun run = startAndAwait(site, "INCREMENTAL");
        JsonNode stored = body(getJson(site.token(), base(site.fx()) + "/generations/" + run.getId() + "/plan?size=500")
                .andExpect(status().isOk()));

        assertThat(stored.path("runId").asLong()).isEqualTo(run.getId());
        assertThat(stored.path("entries").path("content")).isEqualTo(dryRun.path("entries").path("content"));
        // The plan is the same; only the run knows how many redirects it emitted (M30.4.2).
        assertThat(((ObjectNode) stored.path("summary").deepCopy()).put("redirectsActive", (Integer) null))
                .isEqualTo(dryRun.path("summary"));
        assertThat(stored.path("summary").path("redirectsActive").asInt(-1)).isZero();
        assertThat(stored.path("changedAssets")).isEqualTo(dryRun.path("changedAssets"));

        JsonNode history = body(getJson(site.token(), base(site.fx()) + "/generations/" + run.getId()));
        assertThat(history.path("planSummary").path("entryCount").asInt()).isEqualTo(3);
    }

    @Test
    void theDryRunHasNoSideEffectsAndRunsWhileARunIsActive() throws Exception {
        Site site = site("m22side");
        startAndAwait(site, "FULL");
        fixtures.rename(site.fx(), site.hero().uuid(), "Hero image");
        GenerationRun active = runRepository.save(new GenerationRun(site.fx().projectId(), null, GenerationMode.FULL, null,
                site.target().getId(), RunStatus.RUNNING, Instant.now(), null, site.fx().user().getId(), 0, 0, 0, 0, 0, null, null));
        int runs = count("generation_run");
        int entries = count("generation_run_plan_entry");
        int nodes = count("generation_run_plan_node");
        int references = count("asset_reference");

        JsonNode validated = body(dryRun(site, site.token(), "INCREMENTAL", "?validate=true").andExpect(status().isOk()));

        assertThat(validated.path("diagnostics").path("errors")).isEmpty();
        assertThat(List.of(count("generation_run"), count("generation_run_plan_entry"), count("generation_run_plan_node"),
                count("asset_reference"))).containsExactly(runs, entries, nodes, references);
        mvc.perform(post(base(site.fx()) + "/generations")
                        .header("Authorization", "Bearer " + site.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(site.target(), "FULL")))
                .andExpect(status().isConflict());
        runRepository.delete(active);
    }

    @Test
    void storedPlansPageFilterAndHonourRetentionRolesAndProjects() throws Exception {
        Site site = site("m22stored");
        GenerationRun run = startAndAwait(site, "FULL");
        String url = base(site.fx()) + "/generations/" + run.getId() + "/plan";

        JsonNode firstPage = body(getJson(site.token(), url + "?size=2&page=1").andExpect(status().isOk()));
        assertThat(firstPage.path("entries").path("page").path("totalElements").asInt()).isEqualTo(4);
        assertThat(firstPage.path("entries").path("content")).hasSize(2);
        JsonNode filtered = body(getJson(site.token(), url + "?q=TEAM&rootKind=FULL_BUILD&channel=html"));
        assertThat(filtered.path("entries").path("content")).singleElement()
                .satisfies(entry -> assertThat(entry.path("outputPath").asText()).isEqualTo("team.html"));
        assertThat(body(getJson(site.token(), url + "?rootKind=ASSET_CHANGED")).path("entries").path("content")).isEmpty();
        getJson(site.token(), url + "?size=501").andExpect(status().isBadRequest());

        // A viewer reads stored plans but can't dry-run.
        AppUser viewer = userService.create("m22viewer-" + UUID.randomUUID(), UUID.randomUUID() + "@example.com", "Viewer",
                "secret-password");
        projectService.setMemberRole(site.fx().project().getKey(), viewer.getId(), ProjectRole.VIEWER, site.fx().ctx());
        String viewerToken = jwtService.issueAccessToken(viewer);
        getJson(viewerToken, url).andExpect(status().isOk());
        dryRun(site, viewerToken, "FULL", "").andExpect(status().isForbidden());

        // Another project's run is not found.
        Site other = site("m22other");
        getJson(other.token(), base(other.fx()) + "/generations/" + run.getId() + "/plan").andExpect(status().isNotFound());

        runPlanStore.prune(site.fx().projectId(), 0);
        JsonNode pruned = body(getJson(site.token(), url).andExpect(status().isOk()));
        assertThat(pruned.path("summary").path("planAvailable").asBoolean()).isFalse();
        assertThat(pruned.path("summary").path("entryCount").asInt()).isEqualTo(4);
        assertThat(pruned.path("entries").isNull()).isTrue();
    }

    @Test
    void impactListsWhatWouldRebuildWithChains() throws Exception {
        Site site = site("m22impact");
        String assets = base(site.fx()) + "/assets/";

        JsonNode hero = body(getJson(site.token(), assets + site.hero().uuid() + "/impact").andExpect(status().isOk()));
        assertThat(hero.path("entryCount").asInt()).isEqualTo(2);
        assertThat(hero.path("pageCount").asInt()).isEqualTo(2);
        assertThat(hero.path("byFirstEdge").path("REFERENCE").asInt()).isEqualTo(2);
        assertThat(hero.path("entries").path("content")).allSatisfy(entry -> {
            assertThat(entry.path("reason").path("rootAsset").path("uuid").asText()).isEqualTo(site.hero().uuid().toString());
            assertThat(entry.path("reason").path("steps").get(0).path("referenceKind").asText()).isEqualTo("MEDIA_REF");
        });

        JsonNode teaser = body(getJson(site.token(), assets + site.teaser().uuid() + "/impact"));
        assertThat(teaser.path("entries").path("content")).singleElement().satisfies(entry ->
                assertThat(entry.path("reason").path("steps").get(0).path("edge").asText()).isEqualTo("SECTION_TEMPLATE"));

        JsonNode legal = body(getJson(site.token(), assets + site.legal().uuid() + "/impact"));
        assertThat(legal.path("entries").path("content")).singleElement().satisfies(entry ->
                assertThat(entry.path("reason").path("steps")).isEmpty());

        assertThat(body(getJson(site.token(), assets + site.unused().uuid() + "/impact")).path("entryCount").asInt()).isZero();
        assertThat(body(getJson(site.token(), assets + site.hero().uuid() + "/impact?size=1&q=team"))
                .path("entries").path("content")).singleElement();

        Site other = site("m22impactother");
        getJson(other.token(), base(other.fx()) + "/assets/" + site.hero().uuid() + "/impact").andExpect(status().isNotFound());

        // A real edit of the asset plans exactly its impact.
        startAndAwait(site, "FULL");
        fixtures.rename(site.fx(), site.hero().uuid(), "Hero image");
        JsonNode dryRun = body(dryRun(site, site.token(), "INCREMENTAL", "?size=500"));
        assertThat(outputs(dryRun.path("entries"))).isEqualTo(outputs(hero.path("entries")));
    }

    @Test
    void impactOfANavigationReferenceReachesEveryPageRenderingTheNavigation() throws Exception {
        Fixture fx = fixtures.project("m22impactnav");
        TemplateView nav = fixtures.pageTemplate(fx, "Nav", "", "<nav>$CMS_NAVIGATION(nav:root)$</nav>");
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        fixtures.page(fx, "One", nav.uuid());
        fixtures.page(fx, "Two", nav.uuid());
        AssetVersionView target = fixtures.page(fx, "Target", plain.uuid());
        AssetVersionView link = fixtures.pageReference(fx, "Target link", fixtures.navigationRoot(fx), target.uuid());
        releaseFixtures.releaseAll(fx.projectId());
        String token = jwtService.issueAccessToken(fx.user());

        JsonNode impact = body(getJson(token, base(fx) + "/assets/" + link.uuid() + "/impact").andExpect(status().isOk()));

        assertThat(impact.path("pageCount").asInt()).isEqualTo(2);
        assertThat(impact.path("entries").path("content")).allSatisfy(entry -> assertThat(
                StreamSupport.stream(entry.path("reason").path("steps").spliterator(), false).map(step -> step.path("edge").asText()))
                .containsExactly("PAGE_TEMPLATE", "REFERENCE", "NAVIGATION"));
        JsonNode ofTarget = body(getJson(token, base(fx) + "/assets/" + target.uuid() + "/impact"));
        assertThat(ofTarget.path("pageCount").asInt()).as("renaming the target changes its navigation label").isEqualTo(3);
    }
}
