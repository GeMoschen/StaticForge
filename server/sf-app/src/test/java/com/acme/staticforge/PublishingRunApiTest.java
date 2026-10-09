package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunLogStore;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The server side of the Publishing UI overhaul (M35.24): the persisted run log and its endpoint, the replay for a late
 * event subscriber, the run's trigger, the typed plan state and held-back pages, the findings facets and the per-rule
 * counts of the last finished run.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PublishingRunApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        String outputRoot = Files.createTempDirectory("sf-publishing-run-test").toString();
        registry.add("sf.generate.output-root", () -> outputRoot);
    }

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired TemplateService templates;
    @Autowired GenerationRunRepository runs;
    @Autowired GenerationTargetRepository targets;
    @Autowired GenerationService generationService;
    @Autowired RunLogStore runLog;
    @Autowired RunFindingStore store;
    @Autowired TransactionTemplate tx;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser admin, String token, RevisionContext ctx, GenerationTarget target) {}

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(new CreateProjectRequest(prefix + n, prefix + n, null, "publishing"), admin.getId());
        GenerationTarget target = targets.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.createObjectNode(), true));
        return new Fixture(project, admin, jwt.issueAccessToken(users.findById(admin.getId()).orElseThrow()),
                RevisionContext.of(project.getId(), admin.getId(), "publishing"), target);
    }

    private GenerationRun run(Fixture fx, RunStatus status) {
        return runs.save(new GenerationRun(fx.project().getId(), null, GenerationMode.FULL, null, fx.target().getId(), status,
                Instant.now(), status.isTerminal() ? Instant.now() : null, fx.admin().getId(), 0, 0, 0, 0, 0, null, null));
    }

    private String url(Fixture fx, String path) {
        return "/api/v1/projects/" + fx.project().getKey() + path;
    }

    private ResultActions api(Fixture fx, String path) throws Exception {
        return mvc.perform(get(url(fx, path)).header("Authorization", "Bearer " + fx.token()));
    }

    private ResultActions start(Fixture fx, String trigger) throws Exception {
        String body = "{\"mode\":\"FULL\",\"channels\":[\"html\"],\"targetId\":" + fx.target().getId()
                + (trigger == null ? "" : ",\"trigger\":\"" + trigger + "\"") + "}";
        return mvc.perform(post(url(fx, "/generations")).header("Authorization", "Bearer " + fx.token())
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private void awaitTerminal(Fixture fx, long runId) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            if (generationService.status(fx.project().getKey(), runId).getStatus().isTerminal()) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not reach a terminal state within 60s");
    }

    // ------------------------------------------------------------------
    // Log and trigger of a real run
    // ------------------------------------------------------------------

    @Test
    void aRunStoresItsLogAndTheTriggerItWasStartedWith() throws Exception {
        Fixture fx = fixture("pl");
        releaseFixtures.releaseAll(fx.project().getKey());

        String response = start(fx, "RELEASE")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.trigger").value("RELEASE"))
                .andReturn().getResponse().getContentAsString();
        long runId = mapper.readTree(response).path("id").asLong();
        awaitTerminal(fx, runId);

        api(fx, "/generations/" + runId)
                .andExpect(jsonPath("$.trigger").value("RELEASE"))
                .andExpect(jsonPath("$.planState").value("STORED"))
                .andExpect(jsonPath("$.heldBack", hasSize(0)));
        ResultActions log = api(fx, "/generations/" + runId + "/log")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.complete").value(true))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.pruned").value(false))
                .andExpect(jsonPath("$.lines[0].n").value(1))
                .andExpect(jsonPath("$.lines[0].stage").value("SNAPSHOT"))
                .andExpect(jsonPath("$.lines[0].level").value("info"))
                .andExpect(jsonPath("$.lines[0].time").exists());
        JsonNodes lines = JsonNodes.of(mapper, log.andReturn().getResponse().getContentAsString());
        assertThat(lines.stages()).containsSubsequence("SNAPSHOT", "PLAN", "VALIDATE", "RENDER", "ASSETS", "CHECK", "POST", "WRITE", "REPORT");
        assertThat(lines.lastText()).isEqualTo(generationService.status(fx.project().getKey(), runId).getStatus().name());
        assertThat(generationService.status(fx.project().getKey(), runId).getLogBlobSha()).hasSize(64);

        int total = lines.size();
        api(fx, "/generations/" + runId + "/log?from=" + (total - 1))
                .andExpect(jsonPath("$.lines", hasSize(1)))
                .andExpect(jsonPath("$.lines[0].n").value(total));
        api(fx, "/generations/" + runId + "/log?from=" + total).andExpect(jsonPath("$.lines", hasSize(0)));
    }

    @Test
    void aManualRunIsManualAndTheScheduleTriggerIsRefused() throws Exception {
        Fixture fx = fixture("pt");
        releaseFixtures.releaseAll(fx.project().getKey());

        start(fx, "SCHEDULE").andExpect(status().isBadRequest());
        String response = start(fx, null).andExpect(status().isAccepted()).andExpect(jsonPath("$.trigger").value("MANUAL"))
                .andReturn().getResponse().getContentAsString();
        awaitTerminal(fx, mapper.readTree(response).path("id").asLong());
    }

    @Test
    void aRunWithoutAStoredLogReadsAsPruned() throws Exception {
        Fixture fx = fixture("pp");
        GenerationRun old = run(fx, RunStatus.SUCCESS);

        api(fx, "/generations/" + old.getId() + "/log")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pruned").value(true))
                .andExpect(jsonPath("$.complete").value(true))
                .andExpect(jsonPath("$.lines", hasSize(0)));
        api(fx, "/generations/999999/log").andExpect(status().isNotFound());
    }

    @Test
    void aLateSubscriberToARunningRunFirstGetsTheLinesSoFar() throws Exception {
        Fixture fx = fixture("pe");
        GenerationRun running = run(fx, RunStatus.RUNNING);
        runLog.append(running.getId(), "SNAPSHOT", "info", "Snapshotting assets", 0, 0, 0);
        runLog.append(running.getId(), "RENDER", "info", "Rendering pages", 0, 0, 0);
        try {
            api(fx, "/generations/" + running.getId() + "/log")
                    .andExpect(jsonPath("$.complete").value(false))
                    .andExpect(jsonPath("$.lines[*].n", contains(1, 2)));

            MvcResult result = api(fx, "/generations/" + running.getId() + "/events").andReturn();
            String body = result.getResponse().getContentAsString();

            assertThat(body).contains("\"n\":1", "\"stage\":\"SNAPSHOT\"", "\"n\":2", "\"stage\":\"RENDER\"", "\"stage\":\"STATUS\"");
            assertThat(body.indexOf("\"n\":2")).as("the lines come before the status").isLessThan(body.indexOf("\"stage\":\"STATUS\""));
        } finally {
            runLog.finish(running.getId());
        }
    }

    // ------------------------------------------------------------------
    // Typed run fields
    // ------------------------------------------------------------------

    @Test
    void thePlanStateAndTheHeldBackPagesAreTypedFields() throws Exception {
        Fixture fx = fixture("ps");
        TemplateView template = templates.create(new CreateTemplateCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE,
                "Plain", CdlSources.split(""), Map.of("html", "<p>x</p>"), null, false, null), fx.ctx());
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", template.uuid().toString());
        payload.putObject("content");
        AssetVersionView page = assets.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.PAGE, "Home", null, payload, null), fx.ctx());

        GenerationRun queued = run(fx, RunStatus.QUEUED);
        GenerationRun failedEarly = run(fx, RunStatus.FAILED);
        GenerationRun stored = run(fx, RunStatus.PARTIAL);
        stored.setPlanSummary(mapper.createObjectNode().put("entries", 3));
        ObjectNode diagnostics = mapper.createObjectNode();
        diagnostics.putArray("errors");
        diagnostics.putArray("warnings");
        ObjectNode held = diagnostics.putArray("heldBack").addObject();
        held.put("asset", page.uuid().toString());
        held.put("uid", page.uid());
        held.put("channel", "html");
        held.put("locale", "de");
        held.putArray("codes").add("SF-CHK-0301");
        ObjectNode gone = diagnostics.withArray("heldBack").addObject();
        gone.put("asset", UUID.randomUUID().toString());
        gone.put("uid", "removed-page");
        gone.putNull("locale");
        gone.put("channel", "html");
        stored.setDiagnostics(diagnostics);
        runs.save(stored);
        GenerationRun pruned = run(fx, RunStatus.SUCCESS);
        pruned.setPlanSummary(mapper.createObjectNode().put("planAvailable", false));
        runs.save(pruned);

        api(fx, "/generations/" + queued.getId()).andExpect(jsonPath("$.planState").value("PENDING")).andExpect(jsonPath("$.trigger").value("MANUAL"));
        api(fx, "/generations/" + failedEarly.getId()).andExpect(jsonPath("$.planState").value("NONE")).andExpect(jsonPath("$.heldBack", hasSize(0)));
        api(fx, "/generations/" + pruned.getId()).andExpect(jsonPath("$.planState").value("PRUNED"));
        api(fx, "/generations/" + stored.getId())
                .andExpect(jsonPath("$.planState").value("STORED"))
                .andExpect(jsonPath("$.heldBack", hasSize(2)))
                .andExpect(jsonPath("$.heldBack[0].assetUuid").value(page.uuid().toString()))
                .andExpect(jsonPath("$.heldBack[0].name").value("Home"))
                .andExpect(jsonPath("$.heldBack[0].locale").value("de"))
                .andExpect(jsonPath("$.heldBack[0].channel").value("html"))
                .andExpect(jsonPath("$.heldBack[1].name").value("removed-page"))
                .andExpect(jsonPath("$.heldBack[1].locale").value(nullValue()));
        // The JSON stays as it was.
        api(fx, "/generations/" + stored.getId()).andExpect(jsonPath("$.diagnostics.heldBack[0].uid").value(page.uid()));
        api(fx, "/generations").andExpect(jsonPath("$[?(@.id == " + stored.getId() + ")].heldBack[0].name").value("Home"));
    }

    // ------------------------------------------------------------------
    // Findings facets and last-run counts
    // ------------------------------------------------------------------

    private static Finding finding(OutputKey key, String code, QualityCategory category, QualitySeverity severity) {
        return new Finding(key, code, category, severity, code + " on " + key.path(), "body > p", null, false);
    }

    private GenerationRun runWithFindings(Fixture fx, RunStatus status) {
        GenerationRun run = run(fx, status);
        UUID home = UUID.randomUUID();
        UUID old = UUID.randomUUID();
        RunFindingStore.Counts counts = tx.execute(s -> store.save(run.getId(), List.of(
                finding(new OutputKey("de/home.html", home, "html", "de", null), "SF-CHK-0201", QualityCategory.SEO,
                        QualitySeverity.WARNING),
                finding(new OutputKey("de/home.html", home, "html", "de", null), "SF-CHK-0301", QualityCategory.ACCESSIBILITY,
                        QualitySeverity.ERROR),
                finding(new OutputKey("en/home.html", home, "html", "en", null), "SF-CHK-0301", QualityCategory.ACCESSIBILITY,
                        QualitySeverity.WARNING),
                finding(new OutputKey("de/old.html", old, "html", "de", null), "SF-CHK-0101", QualityCategory.LINKS,
                        QualitySeverity.WARNING))));
        tx.executeWithoutResult(s -> {
            GenerationRun stored = runs.findById(run.getId()).orElseThrow();
            counts.applyTo(stored);
            runs.save(stored);
        });
        return run;
    }

    @Test
    void theFacetsReactToTheOtherFiltersAndIgnoreTheirOwn() throws Exception {
        Fixture fx = fixture("pf");
        GenerationRun run = runWithFindings(fx, RunStatus.SUCCESS);
        String facets = "/generations/" + run.getId() + "/findings/facets";

        api(fx, facets)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(4))
                .andExpect(jsonPath("$.severity.ERROR").value(1))
                .andExpect(jsonPath("$.severity.WARNING").value(3))
                .andExpect(jsonPath("$.category.LINKS").value(1))
                .andExpect(jsonPath("$.category.SEO").value(1))
                .andExpect(jsonPath("$.category.ACCESSIBILITY").value(2))
                .andExpect(jsonPath("$.code[*].code", contains("SF-CHK-0101", "SF-CHK-0201", "SF-CHK-0301")))
                .andExpect(jsonPath("$.code[*].count", contains(1, 1, 2)))
                .andExpect(jsonPath("$.code[0].name").isNotEmpty())
                .andExpect(jsonPath("$.locale.de").value(3))
                .andExpect(jsonPath("$.locale.en").value(1));

        // severity=ERROR: the list shrinks to 1, the severity facet still offers WARNING, the others follow the pick.
        api(fx, facets + "?severity=ERROR")
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.severity.ERROR").value(1))
                .andExpect(jsonPath("$.severity.WARNING").value(3))
                .andExpect(jsonPath("$.category.ACCESSIBILITY").value(1))
                .andExpect(jsonPath("$.category.LINKS").value(0))
                .andExpect(jsonPath("$.code[*].code", contains("SF-CHK-0301")))
                .andExpect(jsonPath("$.locale.de").value(1))
                .andExpect(jsonPath("$.locale.en").doesNotExist());

        api(fx, facets + "?locale=en")
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.locale.de").value(3))
                .andExpect(jsonPath("$.locale.en").value(1))
                .andExpect(jsonPath("$.severity.WARNING").value(1))
                .andExpect(jsonPath("$.severity.ERROR").value(0));

        api(fx, facets + "?code=SF-CHK-0301&severity=WARNING")
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.code[*].code", containsInAnyOrder("SF-CHK-0101", "SF-CHK-0201", "SF-CHK-0301")))
                .andExpect(jsonPath("$.category.ACCESSIBILITY").value(1))
                .andExpect(jsonPath("$.category.SEO").value(0));

        api(fx, facets + "?category=seo&code=SF-CHK-0101")
                .andExpect(jsonPath("$.total").value(0))
                .andExpect(jsonPath("$.code[*].code", contains("SF-CHK-0201")));

        api(fx, facets + "?severity=OFF").andExpect(status().isBadRequest());
        // The list endpoint keeps working with the same filters.
        api(fx, "/generations/" + run.getId() + "/findings?severity=ERROR").andExpect(jsonPath("$.page.totalElements").value(1));
        Fixture other = fixture("pg");
        mvc.perform(get(url(other, "/generations/" + run.getId() + "/findings/facets")).header("Authorization", "Bearer " + other.token()))
                .andExpect(status().isNotFound());
    }

    @Test
    void theLastRunCountsComeFromTheNewestFinishedRunOnTheDefaultTarget() throws Exception {
        Fixture fx = fixture("pq");
        api(fx, "/quality-rules/last-run")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.run").value(nullValue()))
                .andExpect(jsonPath("$.counts").value(nullValue()));

        runWithFindings(fx, RunStatus.SUCCESS);
        GenerationRun last = runWithFindings(fx, RunStatus.PARTIAL);
        run(fx, RunStatus.FAILED);
        run(fx, RunStatus.RUNNING);

        api(fx, "/quality-rules/last-run")
                .andExpect(jsonPath("$.run.id").value(last.getId()))
                .andExpect(jsonPath("$.run.status").value("PARTIAL"))
                .andExpect(jsonPath("$.run.targetId").value(fx.target().getId()))
                .andExpect(jsonPath("$.run.findingErrors").value(1))
                .andExpect(jsonPath("$.run.findingWarnings").value(3))
                .andExpect(jsonPath("$.run.truncated").value(0))
                .andExpect(jsonPath("$.counts['SF-CHK-0301']").value(2))
                .andExpect(jsonPath("$.counts['SF-CHK-0201']").value(1))
                .andExpect(jsonPath("$.counts['SF-CHK-0101']").value(1));
        // The rule list itself is unchanged.
        api(fx, "/quality-rules").andExpect(status().isOk()).andExpect(jsonPath("$.rules").exists());
    }

    /** The lines of a log response, read loosely. */
    private record JsonNodes(List<com.fasterxml.jackson.databind.JsonNode> lines) {

        static JsonNodes of(ObjectMapper mapper, String json) throws IOException {
            List<com.fasterxml.jackson.databind.JsonNode> lines = new java.util.ArrayList<>();
            mapper.readTree(json).path("lines").forEach(lines::add);
            return new JsonNodes(lines);
        }

        List<String> stages() {
            return lines.stream().map(line -> line.path("stage").asText()).toList();
        }

        String lastText() {
            return lines.get(lines.size() - 1).path("text").asText();
        }

        int size() {
            return lines.size();
        }
    }
}
