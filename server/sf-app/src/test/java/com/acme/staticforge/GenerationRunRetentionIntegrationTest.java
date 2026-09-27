package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.retention.GenerationRunRetentionJob;
import com.acme.staticforge.generate.target.TargetWriter;
import com.acme.staticforge.generate.target.TargetWriterSelector;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJob;
import com.acme.staticforge.housekeeping.SystemJobFixtures;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.ScheduledActionExecution;
import com.acme.staticforge.scheduler.ScheduledActionExecutionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.UserService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * {@code generation-run-retention} (M29.3.1, epic decision 11): unprotected runs past both limits are deleted with
 * their stored plans; runs with a build on disk (so every promotable build), active runs and recently scheduled runs
 * stay; an incremental build still finds its baseline; a schedule execution of a deleted run shows it as deleted; a
 * dry run reports exactly what the real run deletes.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GenerationRunRetentionIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-retention-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
        registry.add("sf.generate.keep-builds", () -> "2");
    }

    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GenerationTargetRepository targets;
    @Autowired GenerationRunRepository runs;
    @Autowired GenerationService generationService;
    @Autowired TargetWriterSelector writers;
    @Autowired ReleaseFixtures releases;
    @Autowired SchedulerFixtures schedules;
    @Autowired ScheduledActionExecutionRepository executions;
    @Autowired SystemJobRunner jobs;
    @Autowired SystemJobFixtures jobFixtures;
    @Autowired JwtService jwt;
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private BuildInsightFixtures fixtures;
    private final List<Long> created = new ArrayList<>();
    private final java.util.Map<Long, java.util.UUID> plainTemplates = new java.util.HashMap<>();

    @BeforeEach
    void setUp() {
        fixtures = new BuildInsightFixtures(users, projects, assetService, assetRepository, templateService, mediaService,
                pageReferenceService, targets, generationService, releases, outputRoot);
    }

    @AfterEach
    void retire() {
        created.forEach(schedules::retire);
    }

    @Test
    @DisplayName("keepDays 0, keepPerProject 2: unprotected runs go with their plans; builds on disk stay promotable; incremental keeps its baseline")
    void unprotectedRunsBeyondTheNewestTwoAreDeleted() throws Exception {
        Fixture fx = site("ret-basic");
        GenerationTarget target = target(fx);
        long r1 = build(fx, target);
        long r2 = build(fx, target);
        long f1 = failed(fx, target);
        long r3 = build(fx, target);
        long r4 = build(fx, target);
        long f2 = failed(fx, target);
        long r5 = build(fx, target);
        TargetWriter writer = writers.forTarget(fx.project().getKey(), target);
        // keep-builds 2: current (r5) and the two newest other published builds are on disk.
        assertThat(writer.retainedRunIds()).containsExactlyInAnyOrder(r3, r4, r5);
        assertThat(planRows(r1)).isPositive();
        // The plain page has no title, h1 or lang: every build stores quality findings (M30).
        assertThat(findingRows(r1)).isPositive();
        ScheduledAction action = schedules.oneOff(fx.projectId(), "GENERATION",
                fixtures.mapper.readTree("{\"mode\":\"FULL\"}"), Instant.parse("2025-01-01T00:00:00Z"), fx.user().getId());
        ScheduledActionExecution execution = execution(action, r1, Instant.now().minus(Duration.ofDays(3)));
        settings(0, 2);

        SystemJobRun dry = retention(true);
        assertThat(runs.findById(r1)).isPresent();
        SystemJobRun real = retention(false);

        List<String> expected = List.of(sample(fx, r1), sample(fx, r2), sample(fx, f1));
        assertThat(samples(dry, fx)).containsExactlyInAnyOrderElementsOf(expected);
        assertThat(samples(real, fx)).containsExactlyInAnyOrderElementsOf(expected);
        assertThat(real.getReport().path("projects").path(fx.project().getKey()).path("deleted").asInt()).isEqualTo(3);
        assertThat(real.getReport().path("projects").path(fx.project().getKey()).path("oldestRemaining").path("id").asLong())
                .isEqualTo(r3);

        for (long id : List.of(r1, r2, f1)) {
            assertThat(runs.findById(id)).as("run %s", id).isEmpty();
            assertThat(planRows(id)).as("plan rows of run %s", id).isZero();
            assertThat(findingRows(id)).as("quality findings of run %s", id).isZero();
        }
        for (long id : List.of(r3, r4, f2, r5)) {
            assertThat(runs.findById(id)).as("run %s", id).isPresent();
        }
        assertThat(findingRows(r5)).as("a kept run keeps its findings").isPositive();
        String token = jwt.issueAccessToken(fx.user());
        mvc.perform(get("/api/v1/projects/{key}/generations/{id}/plan", fx.project().getKey(), r1)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());

        // The schedule history keeps the id, unlinked, and the API is null-safe.
        ScheduledActionExecution unlinked = executions.findById(execution.getId()).orElseThrow();
        assertThat(unlinked.getGenerationRunId()).isNull();
        assertThat(unlinked.getDetail().path(GenerationRunRetentionJob.DELETED_RUN_KEY).asLong()).isEqualTo(r1);
        mvc.perform(get("/api/v1/projects/{key}/schedules/{id}/executions", fx.project().getKey(), action.getId())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rows[0].generationRunId").doesNotExist())
                .andExpect(jsonPath("$.rows[0].detail.deletedGenerationRunId").value(r1));

        // A promotable build older than both kept runs is still promotable.
        assertThat(generationService.promote(fx.project().getKey(), r3, fx.user().getId()).getId()).isEqualTo(r3);
        assertThat(writer.currentRunId()).isEqualTo(r3);
        generationService.promote(fx.project().getKey(), r5, fx.user().getId());

        // An incremental build after retention still has its baseline: no fallback to full.
        fixtures.page(fx, "Second", template(fx));
        GenerationRun incremental = fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.INCREMENTAL));
        assertThat(incremental.getPlanSummary().path("fallbackCause").isMissingNode()
                || incremental.getPlanSummary().path("fallbackCause").isNull())
                .as("plan summary %s", incremental.getPlanSummary()).isTrue();
        assertThat(incremental.getPlanSummary().path("baseRunId").asLong()).isEqualTo(r5);
    }

    @Test
    @DisplayName("keepDays 30: young runs, active runs and runs of recent schedule executions stay; old ones go")
    void ageActiveAndScheduledRunsAreProtected() throws Exception {
        Fixture fx = site("ret-age");
        GenerationTarget target = target(fx);
        long published = build(fx, target);
        long oldFailed = failed(fx, target);
        long scheduledFailed = failed(fx, target);
        long oldScheduledFailed = failed(fx, target);
        long youngFailed = failed(fx, target);
        long stuck = failed(fx, target);
        jdbc.update("UPDATE generation_run SET status = 'RUNNING', finished_at = NULL WHERE id = ?", stuck);
        Instant old = Instant.now().minus(Duration.ofDays(60));
        for (long id : List.of(oldFailed, scheduledFailed, oldScheduledFailed, stuck)) {
            age(id, old);
        }
        age(youngFailed, Instant.now().minus(Duration.ofDays(10)));
        ScheduledAction action = schedules.oneOff(fx.projectId(), "GENERATION",
                fixtures.mapper.readTree("{\"mode\":\"FULL\"}"), Instant.parse("2025-01-01T00:00:00Z"), fx.user().getId());
        execution(action, scheduledFailed, Instant.now().minus(Duration.ofDays(10)));
        execution(action, oldScheduledFailed, Instant.now().minus(Duration.ofDays(40)));
        settings(30, 0);

        SystemJobRun real = retention(false);

        assertThat(samples(real, fx)).containsExactlyInAnyOrder(sample(fx, oldFailed), sample(fx, oldScheduledFailed));
        assertThat(runs.findById(scheduledFailed)).isPresent();
        assertThat(runs.findById(youngFailed)).isPresent();
        assertThat(runs.findById(stuck)).isPresent();
        assertThat(runs.findById(published)).isPresent();
        jdbc.update("UPDATE generation_run SET status = 'CANCELLED' WHERE id = ?", stuck);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture site(String prefix) {
        Fixture fx = fixtures.project(prefix);
        created.add(fx.projectId());
        fixtures.page(fx, "Home", template(fx));
        releases.releaseAll(fx.projectId());
        return fx;
    }

    private java.util.UUID template(Fixture fx) {
        return plainTemplates.computeIfAbsent(fx.projectId(), id -> fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>").uuid());
    }

    private GenerationTarget target(Fixture fx) {
        GenerationTarget target = fixtures.target(fx, "fs", TargetType.FILESYSTEM);
        target.setDefaultTarget(true);
        return targets.save(target);
    }

    private long build(Fixture fx, GenerationTarget target) {
        return fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.FULL)).getId();
    }

    private long failed(Fixture fx, GenerationTarget target) {
        return runs.saveAndFlush(new GenerationRun(fx.projectId(), 1L, GenerationMode.FULL, "[\"html\"]", target.getId(),
                RunStatus.FAILED, Instant.now(), Instant.now(), fx.user().getId(), 0, 0, 0, 1, 0, null, null)).getId();
    }

    private void age(long runId, Instant at) {
        OffsetDateTime when = OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
        jdbc.update("UPDATE generation_run SET started_at = ? WHERE id = ?", when, runId);
        jdbc.update("UPDATE generation_run SET finished_at = ? WHERE id = ? AND finished_at IS NOT NULL", when, runId);
    }

    private ScheduledActionExecution execution(ScheduledAction action, long runId, Instant startedAt) {
        ScheduledActionExecution execution = new ScheduledActionExecution(action.getId(), startedAt, startedAt, 0, null);
        execution.setGenerationRunId(runId);
        execution.setFinishedAt(startedAt);
        execution.setOutcome(com.acme.staticforge.scheduler.ExecutionOutcome.SUCCEEDED);
        execution.setMessage("Generation run #" + runId + " started.");
        return executions.saveAndFlush(execution);
    }

    private void settings(int keepDays, int keepPerProject) {
        SystemJob row = jobFixtures.row(GenerationRunRetentionJob.KEY);
        row.setSettings(fixtures.mapper.createObjectNode().put("keepDays", keepDays).put("keepPerProject", keepPerProject));
        jobFixtures.save(row);
    }

    private SystemJobRun retention(boolean dryRun) {
        SystemJobRunner.Started started = jobs.start(GenerationRunRetentionJob.KEY, JobTrigger.MANUAL, dryRun, null).orElseThrow();
        started.done().orTimeout(60, TimeUnit.SECONDS).join();
        return jobFixtures.run(started.run().getId());
    }

    private int planRows(long runId) {
        Integer entries = jdbc.queryForObject("SELECT COUNT(*) FROM generation_run_plan_entry WHERE run_id = ?", Integer.class, runId);
        Integer nodes = jdbc.queryForObject("SELECT COUNT(*) FROM generation_run_plan_node WHERE run_id = ?", Integer.class, runId);
        return entries + nodes;
    }

    private int findingRows(long runId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM generation_run_finding WHERE run_id = ?", Integer.class, runId);
    }

    private static String sample(Fixture fx, long runId) {
        return fx.project().getKey() + ": run " + runId;
    }

    private static List<String> samples(SystemJobRun run, Fixture fx) {
        List<String> out = new ArrayList<>();
        run.getReport().path("sample").forEach(item -> {
            if (item.asText().startsWith(fx.project().getKey() + ":")) {
                out.add(item.asText());
            }
        });
        return out;
    }
}
