package com.acme.staticforge.benchmark;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ChangesService;
import com.acme.staticforge.release.ReleaseStateMigration;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Measures the M27 release-state migration and the status reads that follow it (M27.1.1 notes): {@code N} pages in
 * {@code L} languages are created, the project is marked pre-M27, and the initial release (one pointer per page and
 * language) is timed, then a whole-project status evaluation and the Changes list with every tenth page edited.
 *
 * <p>Opt-in like {@link GenerationBenchmark}: {@code SF_PERF=true}, {@code SF_PERF_PAGES} (default 500) and
 * {@code SF_PERF_LOCALES} (default 2). The {@code SFP_BENCH …} summary line goes to stdout and
 * {@code build/perf-results/release-migration-summary.txt}.
 */
@SpringBootTest
@ActiveProfiles("test")
@EnabledIf("perfEnabled")
class ReleaseMigrationBenchmark {

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired ProjectRepository projectRepository;
    @Autowired AssetService assetService;
    @Autowired ReleaseStateMigration migration;
    @Autowired ReleaseStatusService statuses;
    @Autowired ChangesService changes;

    private final ObjectMapper mapper = new ObjectMapper();

    static boolean perfEnabled() {
        return GenerationBenchmark.perfEnabled();
    }

    @Test
    void migrateThenReadStatuses() throws IOException {
        int pages = Integer.parseInt(config("sf.perf.pages", "SF_PERF_PAGES", "500"));
        int locales = Integer.parseInt(config("sf.perf.locales", "SF_PERF_LOCALES", "2"));

        AppUser user = userService.create("relbench", "relbench@example.com", "Release Bench", "password-1234");
        Project project = projectService.create(
                new CreateProjectRequest("relbench", "Release Benchmark", null, "release benchmark"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "release benchmark");
        if (locales > 1) {
            List<ProjectLocale> declared = new ArrayList<>();
            for (int i = 0; i < locales; i++) {
                String code = i == 0 ? "de" : (i == 1 ? "en" : "l" + i);
                declared.add(new ProjectLocale(code, code));
            }
            projectService.updateLocales(project.getKey(), LocaleConfig.of(declared, "de", Map.of(), false), true, ctx);
        }
        ObjectNode templatePayload = mapper.createObjectNode();
        templatePayload.with("channelTemplates").with("html").put("source", "<h1>Page</h1>");
        AssetVersionView template = assetService.create(
                new CreateAssetCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Bench", null, templatePayload, null), ctx);
        List<UUID> created = new ArrayList<>();
        for (int i = 0; i < pages; i++) {
            ObjectNode payload = mapper.createObjectNode();
            payload.put("templateRef", template.uuid().toString());
            payload.putObject("content").put("title", "Page " + i);
            created.add(assetService.create(
                    new CreateAssetCommand(project.getId(), AssetType.PAGE, "Page " + i, null, payload, null), ctx).uuid());
        }

        Project stored = projectRepository.findById(project.getId()).orElseThrow();
        stored.setReleaseStateInitialized(false);
        projectRepository.save(stored);

        long started = System.nanoTime();
        int pointers = migration.initialize(project.getId());
        long migrationMs = (System.nanoTime() - started) / 1_000_000L;
        assertThat(pointers).isGreaterThanOrEqualTo(pages * Math.max(1, locales));

        started = System.nanoTime();
        int evaluated = statuses.ofProject(project.getId()).size();
        long statusMs = (System.nanoTime() - started) / 1_000_000L;

        for (int i = 0; i < pages; i += 10) {
            AssetVersionView current = assetService.requireCurrent(project.getId(), created.get(i));
            ObjectNode payload = current.payload().deepCopy();
            payload.with("content").put("title", "Edited " + i);
            assetService.update(created.get(i), new UpdateAssetCommand(current.displayName(), payload),
                    current.validFromRevision(), ctx);
        }
        started = System.nanoTime();
        long pending = changes.list(project.getId(),
                new ChangesService.Query(null, null, null, null, null, null, null), 0, 50).totalElements();
        long changesMs = (System.nanoTime() - started) / 1_000_000L;
        assertThat(pending).isEqualTo((long) ((pages + 9) / 10) * Math.max(1, locales));

        String summary = String.format(
                "SFP_BENCH release-migration pages=%d, locales=%d, pointers=%d, migrationMs=%d, projectStatusMs=%d (%d assets), "
                        + "changesListMs=%d (%d pending rows)",
                pages, locales, pointers, migrationMs, statusMs, evaluated, changesMs, pending);
        System.out.println(summary);
        Path path = Path.of(config("sf.perf.out", "SF_PERF_OUT", "build/perf-results/release-migration-summary.txt"))
                .toAbsolutePath();
        Files.createDirectories(path.getParent());
        Files.writeString(path, summary + System.lineSeparator(), StandardCharsets.UTF_8);
    }

    private static String config(String property, String env, String fallback) {
        String value = System.getProperty(property);
        if (value == null || value.isBlank()) {
            value = System.getenv(env);
        }
        return value == null || value.isBlank() ? fallback : value;
    }
}
