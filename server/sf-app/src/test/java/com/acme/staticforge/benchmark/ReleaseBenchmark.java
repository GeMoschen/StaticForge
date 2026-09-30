package com.acme.staticforge.benchmark;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ChangesService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseOutcome;
import com.acme.staticforge.release.ReleasePlan;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManagerFactory;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Measures a release of a large selection (M27.1.4): {@code N} never-released pages in {@code L} languages, spread over
 * folders and each referencing one shared media asset, are released the way "Release all" in the Changes view does —
 * one {@link ReleaseService#release} call with one item per (asset, locale) the Changes list shows. The Changes list,
 * the plan (dependency closure) and the release are timed separately, each with its JDBC statement, flush and entity
 * load counts from Hibernate's statistics. No golden check, no build.
 *
 * <p>Opt-in like {@link GenerationBenchmark}: {@code SF_PERF=true}, {@code SF_PERF_PAGES} (default 500) and
 * {@code SF_PERF_LOCALES} (default 2). The {@code SFP_BENCH …} line goes to stdout and
 * {@code build/perf-results/release-summary.txt}.
 */
@SpringBootTest(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
@ActiveProfiles("test")
@EnabledIf("perfEnabled")
class ReleaseBenchmark {

    private static final int PAGES_PER_FOLDER = 100;

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired ChangesService changes;
    @Autowired ReleaseService releases;
    @Autowired EntityManagerFactory entityManagerFactory;

    static boolean perfEnabled() {
        return GenerationBenchmark.perfEnabled();
    }

    @Test
    void releaseALargeSelection() throws IOException {
        int pages = Integer.parseInt(config("sf.perf.pages", "SF_PERF_PAGES", "500"));
        int locales = Integer.parseInt(config("sf.perf.locales", "SF_PERF_LOCALES", "2"));

        AppUser user = userService.create("relbig", "relbig@example.com", "Release Bench", "password-1234");
        Project project = projectService.create(
                new CreateProjectRequest("relbig", "Release Benchmark", null, "release benchmark"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "release benchmark");
        String cdl = "content { editor text title { label \"Title\" required } editor media image { label \"Image\" } }";
        List<String> codes = new ArrayList<>();
        if (locales > 1) {
            List<ProjectLocale> declared = new ArrayList<>();
            for (int i = 0; i < locales; i++) {
                String code = i == 0 ? "de" : (i == 1 ? "en" : "l" + i);
                declared.add(new ProjectLocale(code, code));
                codes.add(code);
            }
            projectService.updateLocales(project.getKey(), LocaleConfig.of(declared, "de", Map.of(), false), true, ctx);
            cdl = "content { editor text title { label \"Title\" required localizable } editor media image { label \"Image\" } }";
        }
        TemplateView template = templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Bench", CdlSources.split(cdl),
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of("html", "{folder}{uid}.{ext}")),
                ctx);
        AssetVersionView media = mediaService.upload(
                project.getId(), null, "logo.txt", null, "logo".getBytes(StandardCharsets.UTF_8), ctx);
        UUID pagesRoot = assetService.ensurePagesRootFolder(project.getId(), ctx).uuid();
        UUID folder = null;
        for (int i = 0; i < pages; i++) {
            if (i % PAGES_PER_FOLDER == 0) {
                folder = folderService.create(pagesRoot, "f" + (i / PAGES_PER_FOLDER), null, ctx).uuid();
            }
            AssetVersionView page = pageService.create(new CreatePageCommand("p" + i, folder, template.uuid()), ctx);
            ObjectNode payload = page.payload().deepCopy();
            ObjectNode content = payload.withObject("content");
            if (codes.isEmpty()) {
                content.put("title", "Page " + i);
            } else {
                ObjectNode title = L10nValues.empty();
                for (String code : codes) {
                    title.withObject("/values").put(code, "Page " + i + " " + code);
                }
                content.set("title", title);
            }
            content.putObject("image").put("type", "MEDIA_REF").put("uuid", media.uuid().toString());
            pageService.update(page.uuid(), payload, page.validFromRevision(), ctx);
        }

        Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        ChangesService.Query everything = new ChangesService.Query(null, null, null, null, null, null, null);

        Measured<ChangesService.Page> list = measure(statistics, () -> changes.list(project.getId(), everything, 0, Integer.MAX_VALUE));
        List<ReleaseItem> items = list.value().rows().stream()
                .filter(row -> row.status() != ReleaseStatus.UNPUBLISHED)
                .map(row -> ReleaseItem.of(row.uuid(), row.locale()))
                .toList();
        assertThat(items).hasSizeGreaterThanOrEqualTo(pages * Math.max(1, locales));

        Measured<ReleasePlan> plan = measure(statistics, () -> releases.plan(project.getId(), items));
        assertThat(plan.value().incomplete()).isEmpty();
        Measured<ReleaseOutcome> release = measure(
                statistics, () -> releases.release(items, RevisionContext.of(project.getId(), user.getId(), "release all")));
        assertThat(release.value().applied()).hasSize(items.size());

        String summary = String.format(
                "SFP_BENCH release pages=%d, locales=%d, items=%d, changesList=%s, plan=%s, release=%s",
                pages, locales, items.size(), list, plan, release);
        System.out.println(summary);
        Path path = Path.of(config("sf.perf.out", "SF_PERF_OUT", "build/perf-results/release-summary.txt"))
                .toAbsolutePath();
        Files.createDirectories(path.getParent());
        Files.writeString(path, summary + System.lineSeparator(), StandardCharsets.UTF_8);
    }

    private static <T> Measured<T> measure(Statistics statistics, Supplier<T> call) {
        statistics.clear();
        long started = System.nanoTime();
        T value = call.get();
        long ms = (System.nanoTime() - started) / 1_000_000L;
        return new Measured<>(value, ms, statistics.getPrepareStatementCount(), statistics.getFlushCount(),
                statistics.getEntityLoadCount());
    }

    private record Measured<T>(T value, long ms, long statements, long flushes, long entityLoads) {

        @Override
        public String toString() {
            return "{ms=" + ms + ", statements=" + statements + ", flushes=" + flushes + ", entityLoads=" + entityLoads + "}";
        }
    }

    private static String config(String property, String env, String fallback) {
        String value = System.getProperty(property);
        if (value == null || value.isBlank()) {
            value = System.getenv(env);
        }
        return value == null || value.isBlank() ? fallback : value;
    }
}
