package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunControl;
import com.acme.staticforge.generate.GenerationRunProbe;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.recovery.GenerationRunRecoveryJob;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJobFixtures;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.node.NodeIdentity;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.ScheduledActionExecution;
import com.acme.staticforge.scheduler.SchedulerEngine;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Interrupted-run recovery and real cancel (M29.2.1): the {@code generation-run-recovery} job fails runs nothing
 * executes (stale heartbeat, this node's orphans, rows from before M29) and leaves live ones alone; a cancel stops a
 * rendering run without publishing it; a cancel racing the final status write never ends in {@code SUCCESS} or a
 * published build after {@code CANCELLED}; a schedule waiting for a stuck run proceeds once it is recovered.
 */
@SpringBootTest
@ActiveProfiles("test")
class GenerationRunRecoveryIntegrationTest {

    private static final String FOREIGN = "other-node-7";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-recovery-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
        registry.add("sf.generate.heartbeat-interval", () -> "1s");
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
    @Autowired GenerationRunControl control;
    @Autowired GenerationProperties generationProperties;
    @Autowired ReleaseFixtures releases;
    @Autowired SchedulerFixtures schedules;
    @Autowired SystemJobRunner jobs;
    @Autowired SystemJobFixtures jobFixtures;
    @Autowired RunLatches latches;
    @Autowired NodeIdentity node;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;

    private BuildInsightFixtures fixtures;
    private final List<Long> created = new ArrayList<>();

    @BeforeEach
    void setUp() {
        fixtures = new BuildInsightFixtures(users, projects, assetService, assetRepository, templateService, mediaService,
                pageReferenceService, targets, generationService, releases, outputRoot);
    }

    @AfterEach
    void retire() {
        created.forEach(schedules::retire);
    }

    private record Site(Fixture fx, GenerationTarget target) {
        String key() {
            return fx.project().getKey();
        }
    }

    // ------------------------------------------------------------------
    // Recovery
    // ------------------------------------------------------------------

    @Test
    @DisplayName("periodic: a stale heartbeat of another node, an old queued run and this node's orphan fail; fresh ones stay")
    void staleRunsAreRecoveredFreshOnesAreNot() throws Exception {
        Site site = site("rec-stale", 1);
        Instant now = Instant.now();
        long stale = active(site, RunStatus.RUNNING, FOREIGN, now.minus(Duration.ofMinutes(10)), now.minus(Duration.ofMinutes(20)));
        long fresh = active(site, RunStatus.RUNNING, "other-node-8", now.minusSeconds(5), now.minus(Duration.ofMinutes(20)));
        long oldQueued = active(site, RunStatus.QUEUED, FOREIGN, null, now.minus(Duration.ofMinutes(6)));
        long newQueued = active(site, RunStatus.QUEUED, FOREIGN, null, now.minusSeconds(30));
        long orphan = active(site, RunStatus.RUNNING, node.id(), now.minusSeconds(5), now.minusSeconds(60));
        long legacy = active(site, RunStatus.QUEUED, null, null, now.minusSeconds(10));

        SystemJobRun report = recover();

        for (long id : List.of(stale, oldQueued, orphan, legacy)) {
            GenerationRun run = runs.findById(id).orElseThrow();
            assertThat(run.getStatus()).as("run %s", id).isEqualTo(RunStatus.FAILED);
            assertThat(run.getFinishedAt()).isNotNull();
            assertThat(run.getErrorCount()).isEqualTo(1);
            assertThat(run.getDiagnostics().path("errors").get(0).path("code").asText()).isEqualTo("SF-GEN-0504");
            assertThat(run.getDiagnostics().path("errors").get(0).path("messages").get(0).asText())
                    .isEqualTo("Run interrupted (node restart or lost heartbeat)");
        }
        assertThat(runs.findById(fresh).orElseThrow().getStatus()).isEqualTo(RunStatus.RUNNING);
        assertThat(runs.findById(newQueued).orElseThrow().getStatus()).isEqualTo(RunStatus.QUEUED);

        List<Long> recovered = new ArrayList<>();
        report.getReport().path("recovered").path(site.key()).forEach(id -> recovered.add(id.asLong()));
        assertThat(recovered).containsExactlyInAnyOrder(stale, oldQueued, orphan, legacy);
        assertThat(report.getItemsAffected()).isGreaterThanOrEqualTo(4);

        // The project builds again once its stuck runs are gone.
        cleanUp(fresh, newQueued);
        fixtures.succeeded(fixtures.generate(site.fx(), site.target(), GenerationMode.FULL));
    }

    @Test
    @DisplayName("a run executing on this node is never recovered, whatever its heartbeat; the heartbeat ticks during a long stage")
    void aLiveLocalRunIsNotRecoveredAndKeepsBeating() throws Exception {
        Site site = site("rec-live", 2);
        RunLatches.Gate gate = latches.arm(site.fx().projectId(), GenerationRunProbe.RENDER_PAGE);
        try {
            long runId = start(site).getId();
            assertThat(gate.awaitArrival()).isEqualTo(runId);
            // A GC pause or a slow disk: the heartbeat looks an hour old.
            Instant old = Instant.now().minus(Duration.ofHours(1));
            jdbc.update("UPDATE generation_run SET heartbeat_at = ? WHERE id = ?", utc(old), runId);

            SystemJobRun report = recover();

            assertThat(runs.findById(runId).orElseThrow().getStatus()).isEqualTo(RunStatus.RUNNING);
            assertThat(report.getReport().path("recovered").has(site.key())).isFalse();
            // Held at one page for longer than the heartbeat interval (1s): the periodic heartbeat moves it on.
            long deadline = System.currentTimeMillis() + 10_000;
            while (!runs.findById(runId).orElseThrow().getHeartbeatAt().isAfter(old.plus(Duration.ofMinutes(30)))) {
                assertThat(System.currentTimeMillis()).as("heartbeat refreshed").isLessThan(deadline);
                Thread.sleep(100);
            }
            gate.release();
            fixtures.succeeded(fixtures.await(site.fx(), runId));
            assertThat(runs.findById(runId).orElseThrow().getExecutorNode()).isEqualTo(node.id());
        } finally {
            latches.disarm(site.fx().projectId(), GenerationRunProbe.RENDER_PAGE);
        }
    }

    @Test
    @DisplayName("a scheduled generation waiting for a stuck run proceeds after the run is recovered")
    void aWaitingScheduleProceedsAfterRecovery() throws Exception {
        Site site = site("rec-sched", 1);
        long stuck = active(site, RunStatus.RUNNING, FOREIGN, Instant.now().minus(Duration.ofMinutes(30)),
                Instant.now().minus(Duration.ofHours(1)));
        Instant runAt = Instant.parse("2025-03-01T10:00:00Z");
        ScheduledAction action = schedules.oneOff(site.fx().projectId(), "GENERATION",
                mapper.readTree("{\"mode\":\"FULL\",\"channels\":[],\"targetId\":null,\"scope\":{\"folderPath\":null,\"assetUuids\":[]}}"),
                runAt, site.fx().user().getId());
        SchedulerEngine engine = schedules.engine("rec-sched-node", new MutableClock(runAt.plusSeconds(1)));
        try {
            schedules.tickOnce(engine);
            ScheduledActionExecution waiting = schedules.executions(action.getId()).get(0);
            assertThat(waiting.isOpen()).isTrue();
            assertThat(waiting.getMessage()).contains("Waiting for run #" + stuck);

            recover();
            assertThat(runs.findById(stuck).orElseThrow().getStatus()).isEqualTo(RunStatus.FAILED);

            schedules.tickOnce(engine);
            ScheduledActionExecution started = schedules.executions(action.getId()).get(0);
            assertThat(started.isOpen()).isFalse();
            assertThat(started.getGenerationRunId()).isNotNull();
            fixtures.succeeded(fixtures.await(site.fx(), started.getGenerationRunId()));
        } finally {
            engine.close();
        }
    }

    // ------------------------------------------------------------------
    // Cancel
    // ------------------------------------------------------------------

    @Test
    @DisplayName("cancel while rendering: the run stays CANCELLED, current is unchanged, no manifest, a final CANCELLED event")
    void cancelWhileRenderingStopsWithoutPublishing() throws Exception {
        Site site = site("rec-cancel", 3);
        GenerationRun published = fixtures.succeeded(fixtures.generate(site.fx(), site.target(), GenerationMode.FULL));
        Path root = fixtures.targetDir(site.fx(), site.target());
        assertThat(currentRunId(root)).isEqualTo(published.getId());

        RunLatches.Gate gate = latches.arm(site.fx().projectId(), GenerationRunProbe.RENDER_PAGE);
        RecordingEmitter events = new RecordingEmitter();
        long runId;
        try {
            runId = start(site).getId();
            generationService.registerEmitter(runId, events);
            assertThat(gate.awaitArrival()).isEqualTo(runId);

            GenerationRun cancelled = generationService.cancel(site.key(), runId, site.fx().user().getId());
            assertThat(cancelled.getStatus()).isEqualTo(RunStatus.CANCELLED);
        } finally {
            latches.disarm(site.fx().projectId(), GenerationRunProbe.RENDER_PAGE);
        }
        awaitReleased(runId);

        GenerationRun after = runs.findById(runId).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(RunStatus.CANCELLED);
        assertThat(after.getFilesWritten()).isZero();
        assertThat(currentRunId(root)).isEqualTo(published.getId());
        assertThat(root.resolve("builds").resolve(runId + ".manifest.json")).doesNotExist();
        assertThat(root.resolve("builds").resolve(String.valueOf(runId))).doesNotExist();
        assertThat(events.messages()).last().isEqualTo("CANCELLED");
        assertThat(events.completed).isTrue();

        // Nothing is left blocking the project.
        fixtures.succeeded(fixtures.generate(site.fx(), site.target(), GenerationMode.FULL));
    }

    @Test
    @DisplayName("race: a cancel concurrent with the final status write, 50 times — never SUCCESS or published after CANCELLED")
    void cancelRacingTheFinalWriteNeverPublishesACancelledRun() throws Exception {
        Site site = site("rec-race", 1);
        Path root = fixtures.targetDir(site.fx(), site.target());
        int cancelledRuns = 0;
        int succeededRuns = 0;
        for (int i = 0; i < 50; i++) {
            long before = currentRunId(root);
            RunLatches.Gate gate = latches.arm(site.fx().projectId(), GenerationRunProbe.PUBLISH);
            long runId;
            GenerationRun cancel;
            try {
                runId = start(site).getId();
                assertThat(gate.awaitArrival()).isEqualTo(runId);
                switch (i % 3) {
                    case 0 -> {
                        // Cancel first: the executor must see it at its checkpoint or under the lock.
                        cancel = generationService.cancel(site.key(), runId, site.fx().user().getId());
                        gate.release();
                    }
                    case 1 -> {
                        // Release and cancel at once, from two threads.
                        CompletableFuture<GenerationRun> racing = CompletableFuture.supplyAsync(
                                () -> generationService.cancel(site.key(), runId, site.fx().user().getId()));
                        gate.release();
                        cancel = racing.get(30, TimeUnit.SECONDS);
                    }
                    default -> {
                        gate.release();
                        spin(ThreadLocalRandom.current().nextInt(0, 3_000));
                        cancel = generationService.cancel(site.key(), runId, site.fx().user().getId());
                    }
                }
            } finally {
                latches.disarm(site.fx().projectId(), GenerationRunProbe.PUBLISH);
            }
            awaitReleased(runId);

            GenerationRun after = runs.findById(runId).orElseThrow();
            boolean manifest = Files.exists(root.resolve("builds").resolve(runId + ".manifest.json"));
            if (cancel.getStatus() == RunStatus.CANCELLED) {
                cancelledRuns++;
                assertThat(after.getStatus()).as("iteration %s: status after a committed cancel", i).isEqualTo(RunStatus.CANCELLED);
                assertThat(currentRunId(root)).as("iteration %s: current after a committed cancel", i).isEqualTo(before);
                assertThat(manifest).as("iteration %s: manifest of a cancelled run", i).isFalse();
            } else {
                succeededRuns++;
                assertThat(cancel.getStatus()).as("iteration %s: cancel of a finished run", i).isEqualTo(RunStatus.SUCCESS);
                assertThat(after.getStatus()).isEqualTo(RunStatus.SUCCESS);
                assertThat(currentRunId(root)).isEqualTo(runId);
                assertThat(manifest).isTrue();
            }
        }
        System.out.printf("SF_RACE cancelled=%d succeeded=%d%n", cancelledRuns, succeededRuns);
        assertThat(cancelledRuns + succeededRuns).isEqualTo(50);
        assertThat(cancelledRuns).as("cancel-first iterations always cancel").isGreaterThanOrEqualTo(17);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** A released site of {@code pages} pages and a filesystem target. */
    private Site site(String prefix, int pages) {
        Fixture fx = fixtures.project(prefix);
        created.add(fx.projectId());
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        for (int i = 1; i <= pages; i++) {
            fixtures.page(fx, "Page " + i, plain.uuid());
        }
        GenerationTarget target = fixtures.target(fx, "primary", TargetType.FILESYSTEM);
        target.setDefaultTarget(true);
        target = targets.save(target);
        releases.releaseAll(fx.projectId());
        return new Site(fx, target);
    }

    private GenerationRun start(Site site) {
        return generationService.start(site.key(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), site.target().getId(), null, null, null, null),
                site.fx().user().getId());
    }

    /** An active run as another node (or a crashed process) left it. */
    private long active(Site site, RunStatus status, String executor, Instant heartbeat, Instant startedAt) {
        GenerationRun run = new GenerationRun(site.fx().projectId(), null, GenerationMode.FULL, "[\"html\"]",
                site.target().getId(), status, startedAt, null, site.fx().user().getId(), 0, 0, 0, 0, 0, null, null);
        run.setExecutorNode(executor);
        long id = runs.saveAndFlush(run).getId();
        jdbc.update("UPDATE generation_run SET heartbeat_at = ? WHERE id = ?", heartbeat == null ? null : utc(heartbeat), id);
        return id;
    }

    /** Ends runs a test left active, so the next build of the project may start. */
    private void cleanUp(long... ids) {
        for (long id : ids) {
            jdbc.update("UPDATE generation_run SET status = 'CANCELLED' WHERE id = ?", id);
        }
    }

    private SystemJobRun recover() {
        SystemJobRunner.Started started = jobs.start(GenerationRunRecoveryJob.KEY, JobTrigger.MANUAL, false, null).orElseThrow();
        started.done().orTimeout(30, TimeUnit.SECONDS).join();
        return jobFixtures.run(started.run().getId());
    }

    /** Waits until this node's executor let go of {@code runId}. */
    private void awaitReleased(long runId) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 30_000;
        while (control.isHeld(runId)) {
            assertThat(System.currentTimeMillis()).as("run %s still executing", runId).isLessThan(deadline);
            Thread.sleep(10);
        }
    }

    private static long currentRunId(Path targetRoot) throws IOException {
        Path current = targetRoot.resolve("current");
        if (!Files.exists(current)) {
            return -1;
        }
        return Files.isSymbolicLink(current)
                ? Long.parseLong(current.toRealPath().getFileName().toString())
                : Long.parseLong(Files.readString(current).trim());
    }

    private static void spin(int micros) {
        long until = System.nanoTime() + micros * 1_000L;
        while (System.nanoTime() < until) {
            Thread.onSpinWait();
        }
    }

    private static OffsetDateTime utc(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    /** An event stream that records what the service sends. */
    private final class RecordingEmitter extends SseEmitter {

        private final List<JsonNode> events = new java.util.concurrent.CopyOnWriteArrayList<>();
        private volatile boolean completed;

        RecordingEmitter() {
            super(60_000L);
        }

        @Override
        public void send(SseEventBuilder builder) {
            for (var part : builder.build()) {
                if (part.getData() instanceof JsonNode json) {
                    events.add(json);
                }
            }
        }

        @Override
        public void complete() {
            completed = true;
        }

        List<String> messages() {
            return events.stream().map(e -> e.path("message").asText()).toList();
        }
    }
}
