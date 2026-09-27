package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.retention.GenerationRunRetentionJob;
import com.acme.staticforge.housekeeping.JobOutcome;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJob;
import com.acme.staticforge.housekeeping.SystemJobFixtures;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.compaction.CompactionResult;
import com.acme.staticforge.revision.compaction.RevisionCompactor;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Revision compaction keeps builds exact (M29.4.2): on a fixture project with released and retained builds, a full
 * build at the released revision and at the retained build's revision is byte-identical before and after compaction
 * (golden comparison of every output file), and an incremental build after compaction plans the same entries.
 */
@SpringBootTest
@ActiveProfiles("test")
class RevisionCompactionBuildIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final Instant DAY_1 = CompactionFixtures.DAY_1;
    private static final Instant DAY_2 = DAY_1.plus(Duration.ofDays(1));
    private static final Instant CUTOFF = DAY_1.plus(Duration.ofDays(60));

    private static final String PAGE_CDL = "content { editor text title { label \"Title\" } }";
    private static final String PAGE_HTML = "<h1>$CMS_VALUE(title)$</h1><nav>$CMS_NAVIGATION(nav:root)$</nav>";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-compaction-build");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired AssetRepository assetRepository;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired PageReferenceService pageReferences;
    @Autowired GenerationTargetRepository targets;
    @Autowired GenerationService generation;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired RevisionCompactor compactor;
    @Autowired CompactionFixtures history;
    @Autowired GenerationRunRepository runs;
    @Autowired SystemJobRunner jobs;
    @Autowired SystemJobFixtures jobFixtures;

    private final ObjectMapper mapper = new ObjectMapper();

    private record Fx(Project project, AppUser user, GenerationTarget target) {
        long id() {
            return project.getId();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), user.getId(), "compaction build");
        }
    }

    @Test
    @DisplayName("full builds at a released and at a retained-build revision are byte-identical after compaction; incremental plans match")
    void buildsStayExact() throws Exception {
        Fx fx = fixture("cmpbld");
        TemplateView template = templates.create(new CreateTemplateCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Page", PAGE_CDL,
                Map.of("html", PAGE_HTML), null, false, Map.of("html", "{folder}{uid}.{ext}")), fx.ctx());
        UUID about = page(fx, template, "about", "About 1");
        UUID news = page(fx, template, "news", "News 1");
        reference(fx, "About", about);
        reference(fx, "News", news);
        title(fx, about, "About 2");
        title(fx, news, "News 2");
        long released = releaseFixtures.releaseAll(fx.id());
        title(fx, about, "About 3");
        title(fx, about, "About 4");
        title(fx, news, "News 3");
        releaseFixtures.releaseAll(fx.id());
        title(fx, about, "About 5 (draft)");
        title(fx, news, "News 4 (draft)");
        long dayEnd = history.head(fx.id());
        title(fx, about, "About 6");
        title(fx, news, "News 5");
        long secondRelease = releaseFixtures.releaseAll(fx.id());
        title(fx, news, "News 6 (draft)");
        long head = history.head(fx.id());
        history.backdate(fx.id(), 1, dayEnd, DAY_1);
        history.backdate(fx.id(), dayEnd + 1, head, DAY_2);

        GenerationRun atRelease = build(fx, GenerationMode.FULL, released);
        GenerationRun retained = build(fx, GenerationMode.FULL, null);
        assertThat(retained.getRevisionId()).isEqualTo(head);
        Map<String, byte[]> goldenRelease = files(fx, atRelease);
        Map<String, byte[]> goldenRetained = files(fx, retained);
        assertThat(new String(goldenRelease.get("about.html"), java.nio.charset.StandardCharsets.UTF_8)).contains("About 2");
        assertThat(new String(goldenRetained.get("about.html"), java.nio.charset.StandardCharsets.UTF_8)).contains("About 6");

        // A change after the retained build: the incremental plan on top of it.
        title(fx, about, "About 7");
        releaseFixtures.releaseAll(fx.id());
        List<PlanEntryRecord> planBefore = incrementalPlan(fx);
        assertThat(planBefore).isNotEmpty();

        CompactionResult result = compactor.compact(fx.id(), CUTOFF, false, null);
        assertThat(result.versionsRemoved()).as("compaction removed something").isPositive();
        assertThat(secondRelease).isGreaterThan(dayEnd);

        assertSameFiles(files(fx, build(fx, GenerationMode.FULL, released)), goldenRelease, "build at the released revision");
        assertSameFiles(files(fx, build(fx, GenerationMode.FULL, head)), goldenRetained, "build at the retained revision");
        assertThat(incrementalPlan(fx)).isEqualTo(planBefore);
    }

    @Test
    @DisplayName("after generation-run-retention ran, compaction keeps the retained build's revision exact and incremental builds keep their baseline")
    void retentionThenCompaction() throws Exception {
        Fx fx = fixture("cmpret");
        TemplateView template = templates.create(new CreateTemplateCommand(fx.id(), AssetType.PAGE_TEMPLATE, "Page", PAGE_CDL,
                Map.of("html", PAGE_HTML), null, false, Map.of("html", "{folder}{uid}.{ext}")), fx.ctx());
        UUID about = page(fx, template, "about", "About 1");
        reference(fx, "About", about);
        title(fx, about, "About 2");
        title(fx, about, "About 3");
        releaseFixtures.releaseAll(fx.id());
        title(fx, about, "About 4");
        title(fx, about, "About 5");
        long dayEnd = history.head(fx.id());
        title(fx, about, "About 6");
        releaseFixtures.releaseAll(fx.id());
        long head = history.head(fx.id());
        history.backdate(fx.id(), 1, dayEnd, DAY_1);
        history.backdate(fx.id(), dayEnd + 1, head, DAY_2);

        GenerationRun retained = build(fx, GenerationMode.FULL, null);
        Map<String, byte[]> golden = files(fx, retained);
        GenerationRun unprotected = runs.saveAndFlush(new GenerationRun(fx.id(), 1L, GenerationMode.FULL, "[\"html\"]",
                fx.target().getId(), RunStatus.FAILED, Instant.now(), Instant.now(), fx.user().getId(), 0, 0, 0, 1, 0, null, null));

        // Retention with no age and no per-project floor: only protected runs (builds on disk) stay.
        SystemJob row = jobFixtures.row(GenerationRunRetentionJob.KEY);
        row.setSettings(mapper.createObjectNode().put("keepDays", 0).put("keepPerProject", 0));
        jobFixtures.save(row);
        SystemJobRunner.Started started = jobs.start(GenerationRunRetentionJob.KEY, JobTrigger.MANUAL, false, null).orElseThrow();
        started.done().orTimeout(60, TimeUnit.SECONDS).join();
        assertThat(jobFixtures.run(started.run().getId()).getOutcome()).isEqualTo(JobOutcome.SUCCEEDED);
        assertThat(runs.findById(unprotected.getId())).as("unprotected run").isEmpty();
        assertThat(runs.findById(retained.getId())).as("run with a build on disk").isPresent();

        CompactionResult result = compactor.compact(fx.id(), CUTOFF, false, null);
        assertThat(result.versionsRemoved()).as("compaction removed something").isPositive();
        GenerationRun rebuilt = build(fx, GenerationMode.FULL, head);
        assertSameFiles(files(fx, rebuilt), golden, "build at the retained revision");

        title(fx, about, "About 7");
        releaseFixtures.releaseAll(fx.id());
        GenerationRun incremental = build(fx, GenerationMode.INCREMENTAL, null);
        assertThat(incremental.getPlanSummary().path("fallbackCause").isMissingNode()
                || incremental.getPlanSummary().path("fallbackCause").isNull())
                .as("plan summary %s", incremental.getPlanSummary()).isTrue();
        assertThat(incremental.getPlanSummary().path("baseRunId").asLong()).isIn(retained.getId(), rebuilt.getId());
        assertThat(new String(files(fx, incremental).get("about.html"), java.nio.charset.StandardCharsets.UTF_8))
                .contains("About 7");
    }

    private List<PlanEntryRecord> incrementalPlan(Fx fx) {
        return generation.dryRun(fx.project().getKey(), request(GenerationMode.INCREMENTAL, null, fx), false).entries();
    }

    private static void assertSameFiles(Map<String, byte[]> actual, Map<String, byte[]> golden, String what) {
        assertThat(actual.keySet()).as(what + ": paths").isEqualTo(golden.keySet());
        golden.forEach((path, bytes) -> assertThat(actual.get(path)).as(what + ": " + path).isEqualTo(bytes));
    }

    private Fx fixture(String prefix) throws IOException {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create(prefix + n, prefix + n + "@example.com", "Compaction", "secret-password");
        Project project = projects.create(new CreateProjectRequest(prefix + n, prefix + n, null, "compaction"), user.getId());
        GenerationTarget target = targets.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
        return new Fx(project, user, target);
    }

    private UUID page(Fx fx, TemplateView template, String name, String title) {
        AssetVersionView page = pages.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx());
        title(fx, page.uuid(), title);
        return page.uuid();
    }

    private void title(Fx fx, UUID page, String title) {
        AssetVersionView current = assets.requireCurrent(fx.id(), page);
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("content").put("title", title);
        pages.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private void reference(Fx fx, String name, UUID page) {
        UUID root = assetRepository
                .findByProjectIdAndAssetTypeAndUid(fx.id(), AssetType.FOLDER, FolderScope.NAVIGATION_ROOT_UID)
                .map(Asset::getUuid)
                .orElseThrow();
        pageReferences.create(new CreatePageReferenceCommand(name, root, PageReferenceTargetKind.PAGE, page, null), fx.ctx());
    }

    private static GenerationRequest request(GenerationMode mode, Long revision, Fx fx) {
        return new GenerationRequest(mode, revision, List.of("html"), fx.target().getId(), null, null, null, null);
    }

    private GenerationRun build(Fx fx, GenerationMode mode, Long revision) throws InterruptedException {
        GenerationRun started = generation.start(fx.project().getKey(), request(mode, revision, fx), fx.user().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generation.status(fx.project().getKey(), started.getId());
            if (run.getStatus().isTerminal()) {
                assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isIn(RunStatus.SUCCESS, RunStatus.PARTIAL);
                return run;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("Generation did not finish within 60s");
    }

    private Map<String, byte[]> files(Fx fx, GenerationRun run) throws IOException {
        Path dir = TargetLocations.resolve(outputRoot, fx.project().getKey(), fx.target())
                .resolve("builds")
                .resolve(String.valueOf(run.getId()));
        Map<String, byte[]> files = new TreeMap<>();
        try (Stream<Path> stream = Files.walk(dir)) {
            for (Path file : stream.filter(Files::isRegularFile).toList()) {
                files.put(dir.relativize(file).toString().replace('\\', '/'), Files.readAllBytes(file));
            }
        }
        return files;
    }
}
