package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
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
import com.acme.staticforge.generate.cleanup.BuildOutputCleanupJob;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.target.TargetWriter;
import com.acme.staticforge.generate.target.TargetWriterSelector;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJobFixtures;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * {@code build-output-cleanup} and published-only rollback slots (M29.2.2): staged output of failed and cancelled runs,
 * output without a run, stale temporary links and deleted targets' folders go; published builds, {@code current}, and
 * the folders of existing targets stay; a dry run reports exactly what the real run removes; promote refuses a run
 * that was never published.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BuildOutputCleanupIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-cleanup-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
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
    @Autowired TargetWriterSelector writers;
    @Autowired ReleaseFixtures releases;
    @Autowired SchedulerFixtures schedules;
    @Autowired SystemJobRunner jobs;
    @Autowired SystemJobFixtures jobFixtures;
    @Autowired RunLatches latches;
    @Autowired JwtService jwt;
    @Autowired MockMvc mvc;

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

    @Test
    @DisplayName("filesystem: a cancelled run's staged build, a failed run's build, output without a run and old temp links go")
    void filesystemCleanup() throws Exception {
        Fixture fx = site("clean-fs");
        GenerationTarget target = target(fx, "fs", TargetType.FILESYSTEM, null);
        Path root = fixtures.targetDir(fx, target);
        GenerationRun first = fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.FULL));
        GenerationRun second = fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.FULL));

        // A run cancelled after staging, right before publishing: its build is on disk, never published.
        long cancelled = cancelAtPublish(fx, target);
        assertThat(root.resolve("builds/" + cancelled)).isDirectory();
        assertThat(root.resolve("builds/" + cancelled + ".manifest.json")).doesNotExist();
        // A failed run that staged, and output of a run that has no row (deleted), both old.
        long failed = failedRun(fx, target);
        TargetWriter writer = writers.forTarget(fx.project().getKey(), target);
        writer.stage(failed, List.of(file("index.html", "failed")));
        writer.stage(999_999, List.of(file("index.html", "orphan")));
        age(root.resolve("builds/999999"));
        Path link = Files.writeString(root.resolve(".current-42.link"), "left behind");
        age(link);
        Path freshLink = Files.writeString(root.resolve(".current-43.link"), "a flip in progress");

        SystemJobRun dry = runCleanup(true);
        SystemJobRun real = runCleanup(false);

        List<String> expected = List.of(
                rel(root.resolve("builds/" + cancelled)) + " (CANCELLED)",
                rel(root.resolve("builds/" + failed)) + " (FAILED)",
                rel(root.resolve("builds/999999")) + " (no run)",
                rel(link) + " (temporary link)");
        assertThat(samples(dry, fx)).containsExactlyInAnyOrderElementsOf(expected);
        assertThat(samples(real, fx)).containsExactlyInAnyOrderElementsOf(expected);
        assertThat(dry.getBytesFreed()).isEqualTo(real.getBytesFreed()).isPositive();
        assertThat(dry.getItemsAffected()).isEqualTo(real.getItemsAffected());
        JsonNode dryTarget = dry.getReport().path("projects").path(fx.project().getKey()).path("targets").path("target-" + target.getId());
        JsonNode realTarget = real.getReport().path("projects").path(fx.project().getKey()).path("targets").path("target-" + target.getId());
        assertThat(realTarget.path("removed").asLong()).isEqualTo(4);
        assertThat(dryTarget).isEqualTo(realTarget);

        assertThat(root.resolve("builds/" + cancelled)).doesNotExist();
        assertThat(root.resolve("builds/" + failed)).doesNotExist();
        assertThat(root.resolve("builds/999999")).doesNotExist();
        assertThat(link).doesNotExist();
        assertThat(freshLink).exists();
        // Published builds within keep-builds and the current one stay.
        assertThat(root.resolve("builds/" + first.getId())).isDirectory();
        assertThat(root.resolve("builds/" + second.getId())).isDirectory();
        assertThat(root.resolve("builds/" + second.getId() + ".manifest.json")).exists();
        assertThat(writer.currentRunId()).isEqualTo(second.getId());
    }

    @Test
    @DisplayName("zip: a failed run's staged archive and manifest go; published archives stay; a dry run deletes nothing")
    void zipCleanup() throws Exception {
        Fixture fx = site("clean-zip");
        GenerationTarget target = target(fx, "zip", TargetType.ZIP, null);
        Path root = fixtures.targetDir(fx, target);
        GenerationRun published = fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.FULL));
        long failed = failedRun(fx, target);
        TargetWriter writer = writers.forTarget(fx.project().getKey(), target);
        writer.stage(failed, List.of(file("index.html", "failed")));
        writer.writeManifest(failed, writer.readManifest(published.getId()).orElseThrow());

        SystemJobRun dry = runCleanup(true);
        assertThat(root.resolve("builds/" + failed + ".zip.tmp")).exists();
        assertThat(root.resolve("builds/" + failed + ".manifest.json")).exists();
        SystemJobRun real = runCleanup(false);

        assertThat(samples(real, fx)).containsExactlyInAnyOrder(
                rel(root.resolve("builds/" + failed + ".zip.tmp")) + " (FAILED)",
                rel(root.resolve("builds/" + failed + ".manifest.json")) + " (FAILED)");
        assertThat(samples(dry, fx)).containsExactlyInAnyOrderElementsOf(samples(real, fx));
        assertThat(dry.getBytesFreed()).isEqualTo(real.getBytesFreed()).isPositive();
        assertThat(root.resolve("builds/" + failed + ".zip.tmp")).doesNotExist();
        assertThat(root.resolve("builds/" + published.getId() + ".zip")).exists();
        assertThat(root.resolve("builds/" + published.getId() + ".manifest.json")).exists();
        assertThat(writer.currentRunId()).isEqualTo(published.getId());
    }

    @Test
    @DisplayName("a deleted target's folder goes; an existing target's custom config.path folder stays")
    void deletedTargetFolders() throws Exception {
        Fixture fx = site("clean-tgt");
        GenerationTarget kept = target(fx, "custom", TargetType.FILESYSTEM, "site/live");
        GenerationTarget deleted = target(fx, "gone", TargetType.FILESYSTEM, null);
        fixtures.succeeded(fixtures.generate(fx, kept, GenerationMode.FULL));
        fixtures.succeeded(fixtures.generate(fx, deleted, GenerationMode.FULL));
        Path keptDir = fixtures.targetDir(fx, kept);
        Path deletedDir = fixtures.targetDir(fx, deleted);
        targets.delete(deleted);
        age(deletedDir);

        SystemJobRun dry = runCleanup(true);
        assertThat(deletedDir).isDirectory();
        SystemJobRun real = runCleanup(false);

        assertThat(samples(real, fx)).containsExactly(rel(deletedDir) + " (no target)");
        assertThat(samples(dry, fx)).containsExactly(rel(deletedDir) + " (no target)");
        assertThat(dry.getBytesFreed()).isEqualTo(real.getBytesFreed()).isPositive();
        JsonNode removed = real.getReport().path("projects").path(fx.project().getKey()).path("deletedTargets");
        assertThat(removed).hasSize(1);
        assertThat(removed.get(0).path("path").asText()).isEqualTo(rel(deletedDir));
        assertThat(deletedDir).doesNotExist();
        assertThat(keptDir).isDirectory();
        assertThat(keptDir.resolve("current")).exists();
    }

    @Test
    @DisplayName("promote of a FAILED run answers 409 SF-GEN-0505 and current is unchanged")
    void promoteRefusesAFailedRun() throws Exception {
        Fixture fx = site("clean-promote");
        GenerationTarget target = target(fx, "fs", TargetType.FILESYSTEM, null);
        GenerationRun published = fixtures.succeeded(fixtures.generate(fx, target, GenerationMode.FULL));
        long failed = failedRun(fx, target);
        TargetWriter writer = writers.forTarget(fx.project().getKey(), target);
        writer.stage(failed, List.of(file("index.html", "partial output")));

        mvc.perform(post("/api/v1/projects/{key}/generations/{id}/promote", fx.project().getKey(), failed)
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(fx.user())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-GEN-0505"));

        assertThat(writer.currentRunId()).isEqualTo(published.getId());
        mvc.perform(post("/api/v1/projects/{key}/generations/{id}/promote", fx.project().getKey(), published.getId())
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(fx.user())))
                .andExpect(status().isOk());
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture site(String prefix) {
        Fixture fx = fixtures.project(prefix);
        created.add(fx.projectId());
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        fixtures.page(fx, "Home", plain.uuid());
        releases.releaseAll(fx.projectId());
        return fx;
    }

    private GenerationTarget target(Fixture fx, String name, TargetType type, String path) throws IOException {
        GenerationTarget target = fixtures.target(fx, name, type);
        if (path != null) {
            target.setConfig(fixtures.mapper.readTree("{\"baseUrl\":\"https://example.com\",\"path\":\"" + path + "\"}"));
        }
        return targets.save(target);
    }

    /** Runs a build of {@code target} and cancels it at the moment it would publish; its id. */
    private long cancelAtPublish(Fixture fx, GenerationTarget target) throws Exception {
        RunLatches.Gate gate = latches.arm(fx.projectId(), GenerationRunProbe.PUBLISH);
        long runId;
        try {
            runId = generationService.start(fx.project().getKey(),
                    new GenerationRequest(GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, null),
                    fx.user().getId()).getId();
            assertThat(gate.awaitArrival()).isEqualTo(runId);
            assertThat(generationService.cancel(fx.project().getKey(), runId, fx.user().getId()).getStatus())
                    .isEqualTo(RunStatus.CANCELLED);
        } finally {
            latches.disarm(fx.projectId(), GenerationRunProbe.PUBLISH);
        }
        long deadline = System.currentTimeMillis() + 30_000;
        while (control.isHeld(runId)) {
            assertThat(System.currentTimeMillis()).isLessThan(deadline);
            Thread.sleep(10);
        }
        return runId;
    }

    /** A run row that ended FAILED for {@code target}. */
    private long failedRun(Fixture fx, GenerationTarget target) {
        return runs.saveAndFlush(new GenerationRun(fx.projectId(), 1L, GenerationMode.FULL, "[\"html\"]", target.getId(),
                RunStatus.FAILED, Instant.now(), Instant.now(), fx.user().getId(), 0, 0, 0, 1, 0, null, null)).getId();
    }

    private SystemJobRun runCleanup(boolean dryRun) {
        SystemJobRunner.Started started = jobs.start(BuildOutputCleanupJob.KEY, JobTrigger.MANUAL, dryRun, null).orElseThrow();
        started.done().orTimeout(60, TimeUnit.SECONDS).join();
        return jobFixtures.run(started.run().getId());
    }

    /** The run's sample items of {@code fx}'s project (other tests' leftovers in the shared database are ignored). */
    private static List<String> samples(SystemJobRun run, Fixture fx) {
        List<String> out = new ArrayList<>();
        run.getReport().path("sample").forEach(item -> {
            if (item.asText().startsWith(fx.project().getKey() + "/")) {
                out.add(item.asText());
            }
        });
        return out;
    }

    private static String rel(Path path) {
        return outputRoot.toAbsolutePath().normalize().relativize(path.toAbsolutePath().normalize()).toString().replace('\\', '/');
    }

    private static OutputFile file(String path, String text) {
        return new OutputFile(path, text.getBytes(StandardCharsets.UTF_8));
    }

    /** Makes {@code path} (and everything under it) two hours old, older than the default minAge. */
    private static void age(Path path) throws IOException {
        FileTime old = FileTime.from(Instant.now().minus(Duration.ofHours(2)));
        try (Stream<Path> walk = Files.walk(path)) {
            for (Path p : walk.sorted(java.util.Comparator.reverseOrder()).toList()) {
                Files.setLastModifiedTime(p, old);
            }
        }
    }
}
