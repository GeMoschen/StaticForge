package com.acme.staticforge.benchmark;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Generation-performance benchmark (spec §18.6, §26.1, §25.1). Builds a real project fixture —
 * one page template plus {@code N} pages through the production {@code AssetService} so the
 * revision machinery and generation pipeline run realistically — then times a FULL generation
 * and, after editing a single page, an INCREMENTAL generation.
 *
 * <p>The benchmark is <strong>off by default</strong> and gated behind {@code sf.perf} (system
 * property) or {@code SF_PERF} (environment variable) so the default {@code ./gradlew build}
 * stays green. It is meant to be driven by {@code infra/scripts/benchmark-generation.sh}; the
 * 5,000- and 50,000-page matrix belongs to the nightly CI job, not a per-push gate.
 */
@SpringBootTest
@ActiveProfiles("test")
@EnabledIf("perfEnabled")
class GenerationBenchmark {

    /** Minimal, deterministic page template; the page-count dominates measured throughput. */
    private static final String TEMPLATE_SOURCE =
            "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<title>Page</title>\n</head>\n"
                    + "<body>\n<h1>Page</h1>\n<p>StaticForge generation benchmark page.</p>\n</body>\n</html>\n";

    private static final int DEFAULT_PAGES = 500;

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-perf-");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;

    private final ObjectMapper mapper = new ObjectMapper();

    /** Enables the benchmark via {@code -Dsf.perf=true} or the {@code SF_PERF=true} env var. */
    static boolean perfEnabled() {
        if ("true".equalsIgnoreCase(System.getProperty("sf.perf"))) {
            return true;
        }
        return "true".equalsIgnoreCase(System.getenv("SF_PERF"));
    }

    @Test
    void benchmarkFullThenIncremental() throws Exception {
        int pages = Integer.parseInt(config("sf.perf.pages", "SF_PERF_PAGES", String.valueOf(DEFAULT_PAGES)));

        AppUser user = userService.create("bench-user", "bench-user@example.com", "Benchmark User", "password-1234");
        Project project = projectService.create(
                new CreateProjectRequest("benchproj", "Benchmark Project", null, "generation benchmark"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "generation benchmark");

        AssetVersionView template = createPageTemplate(project, ctx);

        long fixtureStart = System.nanoTime();
        UUID editedPageUuid = null;
        long editedValidFromRevision = 0;
        String editedDisplayName = null;
        for (int i = 0; i < pages; i++) {
            AssetVersionView created = createPage(project, ctx, template.uuid(), i);
            if (i == 0) {
                editedPageUuid = created.uuid();
                editedValidFromRevision = created.validFromRevision();
                editedDisplayName = created.displayName();
            }
        }
        long fixtureMs = (System.nanoTime() - fixtureStart) / 1_000_000L;

        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"),
                true));

        TimedRun full = run(project.getKey(), GenerationMode.FULL, target.getId(), user.getId(), pages);

        editPage(template.uuid(), editedPageUuid, editedDisplayName, editedValidFromRevision, ctx);

        TimedRun incremental = run(project.getKey(), GenerationMode.INCREMENTAL, target.getId(), user.getId(), pages);

        String summary = String.format(
                "pages=%d, fullMs=%d, incrementalMs=%d, filesWritten=%d, incrementalFilesWritten=%d, fixtureMs=%d",
                pages, full.millis(), incremental.millis(), full.run().getFilesWritten(),
                incremental.run().getFilesWritten(), fixtureMs);
        System.out.println("SFP_BENCH " + summary);
        writeSummary(summary);
    }

    private AssetVersionView createPageTemplate(Project project, RevisionContext ctx) {
        ObjectNode payload = mapper.createObjectNode();
        payload.with("channelTemplates").with("html").put("source", TEMPLATE_SOURCE);
        return assetService.create(
                new CreateAssetCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Benchmark Template", null, payload, null), ctx);
    }

    private AssetVersionView createPage(Project project, RevisionContext ctx, UUID templateUuid, int index) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", templateUuid.toString());
        ObjectNode content = payload.putObject("content");
        content.put("title", "Page " + index);
        content.put("body", "Body text for benchmark page " + index + ".");
        return assetService.create(
                new CreateAssetCommand(project.getId(), AssetType.PAGE, "Benchmark Page " + index, null, payload, null), ctx);
    }

    private void editPage(UUID templateUuid, UUID pageUuid, String displayName, long expectedRevision, RevisionContext ctx) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", templateUuid.toString());
        payload.putObject("content").put("title", "edited").put("body", "edited body");
        assetService.update(pageUuid, new UpdateAssetCommand(displayName, payload), expectedRevision, ctx);
    }

    private TimedRun run(String projectKey, GenerationMode mode, Long targetId, Long userId, int pages)
            throws InterruptedException {
        long start = System.nanoTime();
        GenerationRun started = generationService.start(
                projectKey,
                new GenerationRequest(mode, null, List.of("html"), targetId, null, null, null, null),
                userId);
        GenerationRun terminal = awaitTerminal(projectKey, started.getId(), timeoutMillis(pages));
        assertThat(terminal.getStatus()).isIn(RunStatus.SUCCESS, RunStatus.PARTIAL);
        return new TimedRun((System.nanoTime() - start) / 1_000_000L, terminal);
    }

    private GenerationRun awaitTerminal(String projectKey, long runId, long timeoutMillis) throws InterruptedException {
        long deadline = System.nanoTime() + timeoutMillis * 1_000_000L;
        while (System.nanoTime() < deadline) {
            GenerationRun run = generationService.status(projectKey, runId);
            RunStatus status = run.getStatus();
            if (status == RunStatus.SUCCESS || status == RunStatus.PARTIAL || status == RunStatus.FAILED
                    || status == RunStatus.CANCELLED) {
                return run;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not reach a terminal state within " + timeoutMillis + "ms");
    }

    private long timeoutMillis(int pages) {
        String configured = config("sf.perf.timeoutMs", "SF_PERF_TIMEOUT_MS", null);
        if (configured != null) {
            return Long.parseLong(configured);
        }
        return Math.max(60_000L, (long) pages * 150L);
    }

    private void writeSummary(String summary) throws IOException {
        Path path = Path.of(config("sf.perf.out", "SF_PERF_OUT", "build/perf-results/generation-summary.txt"))
                .toAbsolutePath();
        Files.createDirectories(path.getParent());
        Files.writeString(path, summary + System.lineSeparator(), StandardCharsets.UTF_8);
        System.out.println("summary written to " + path);
    }

    private static String config(String property, String env, String fallback) {
        String value = System.getProperty(property);
        if (value == null || value.isBlank()) {
            value = System.getenv(env);
        }
        return value == null || value.isBlank() ? fallback : value;
    }

    private record TimedRun(long millis, GenerationRun run) {}
}
