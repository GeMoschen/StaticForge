package com.acme.staticforge.benchmark;

import com.acme.staticforge.ReleaseFixtures;
import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.RecordSetFixtures;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.CreateRecordSetCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.UpdateDatasetCommand;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
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
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.query.RecordSetQuery;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Dataset benchmark (M19.1.2, M19.3.2, M19.5.2): {@code SF_PERF_RECORDS} records (default 5,000)
 * looped by {@code SF_PERF_PAGES} pages (default 500) — record creation, a FULL and an INCREMENTAL
 * generation after one record edit, and a {@code renamedFrom} schema change migrating every record in
 * one revision. Record sets (M25.2.3): the same records in 10 sets rendered by the same number of pages
 * — a FULL and single-record INCREMENTAL generations. Off by default, gated like
 * {@link GenerationBenchmark}; the summary lines are {@code SFD_BENCH …} and {@code SFRS_BENCH …}.
 */
@SpringBootTest
@ActiveProfiles("test")
@EnabledIf("com.acme.staticforge.benchmark.GenerationBenchmark#perfEnabled")
class DatasetBenchmark {

    private static final String SCHEMA =
            """
            content {
              editor text name { label "Name" }
              editor text role { label "Role" }
              editor number level { label "Level" }
            }
            """;

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-perf-dataset-");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired com.acme.staticforge.asset.dataset.RecordSetService recordSetService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void recordsLoopedByPagesThenRename() throws Exception {
        int records = Integer.parseInt(env("SF_PERF_RECORDS", "5000"));
        int pages = Integer.parseInt(env("SF_PERF_PAGES", "500"));

        AppUser user = userService.create("dsbench-user", "dsbench-user@example.com", "Dataset Bench", "password-1234");
        Project project = projectService.create(
                new CreateProjectRequest("dsbench", "Dataset Benchmark", null, null), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "dataset benchmark");

        DatasetView team = datasetService.create(
                new CreateDatasetCommand(project.getId(), null, "Team", CdlSources.split(SCHEMA), "name", null), ctx);
        UUID members = new RecordSetFixtures(recordSetService).setFor(project.getId(), team.uuid(), null, ctx);
        long start = System.nanoTime();
        com.acme.staticforge.asset.dataset.RecordDetail first = null;
        com.acme.staticforge.asset.dataset.RecordDetail developer = null;
        for (int i = 0; i < records; i++) {
            ObjectNode content = mapper.createObjectNode()
                    .put("name", "Member " + i)
                    .put("role", i % 5 == 0 ? "lead" : "dev")
                    .put("level", i % 7);
            var created = recordService.create(
                    new CreateRecordCommand(project.getId(), members, content), ctx).record();
            if (first == null) {
                first = created;
            } else if (developer == null) {
                developer = created;
            }
        }
        long createMs = millisSince(start);

        // One page of the record listing, as the grid asks for it (M19.2.1).
        recordService.list(project.getId(), team.uuid(),
                new com.acme.staticforge.asset.dataset.RecordService.RecordListQuery(
                        null, null, "role == 'lead'", List.of(com.acme.staticforge.template.query.SortKey.desc("level"))),
                0, 50);
        start = System.nanoTime();
        var page = recordService.list(project.getId(), team.uuid(),
                new com.acme.staticforge.asset.dataset.RecordService.RecordListQuery(
                        null, null, "role == 'lead'", List.of(com.acme.staticforge.template.query.SortKey.desc("level"))),
                3, 50);
        long listMs = millisSince(start);
        assertThat(page.rows()).hasSize(50);

        TemplateView template = templateService.create(
                new CreateTemplateCommand(
                        project.getId(), AssetType.PAGE_TEMPLATE, "Team Page", CdlSources.split(""),
                        Map.of("html", "<ul>$CMS_FOR(m : dataset:team, where=\"m.role == 'lead'\", sort=\"-level,name\", limit=20)$"
                                + "<li>$CMS_VALUE(m.name)$</li>$CMS_END_FOR$</ul>"),
                        null, false, Map.of("html", "{displayNameSlug}.{ext}")),
                ctx);
        for (int i = 0; i < pages; i++) {
            pageService.create(new CreatePageCommand("Page " + i, null, template.uuid()), ctx);
        }
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));

        start = System.nanoTime();
        GenerationRun full = generate(project, target, user, GenerationMode.FULL);
        long fullMs = millisSince(start);

        recordService.update(first.uuid(), mapper.createObjectNode().put("name", "Member zero").put("role", "lead"), first.revision(), ctx);
        start = System.nanoTime();
        GenerationRun incremental = generate(project, target, user, GenerationMode.INCREMENTAL);
        long incrementalMs = millisSince(start);

        // A record every page's loop filters out: planning proves no page renders it (M19.3.2).
        recordService.update(developer.uuid(), mapper.createObjectNode().put("name", "Member one").put("role", "dev"), developer.revision(), ctx);
        start = System.nanoTime();
        GenerationRun unselected = generate(project, target, user, GenerationMode.INCREMENTAL);
        long unselectedMs = millisSince(start);

        start = System.nanoTime();
        DatasetView current = datasetService.find(project.getId(), team.uuid(), null).orElseThrow();
        datasetService.update(
                team.uuid(),
                new UpdateDatasetCommand("Team", CdlSources.split(SCHEMA.replace("editor text role { label \"Role\"",
                        "editor text position { label \"Position\" renamedFrom \"role\"")), "name", null),
                current.revision(),
                ctx);
        long renameMs = millisSince(start);

        String summary = String.format(
                "records=%d, pages=%d, createMs=%d, listPageMs=%d, fullMs=%d (%s, %d files), incrementalMs=%d (%s, %d files),"
                        + " unselectedIncrementalMs=%d (%s, %d files), renameMs=%d",
                records, pages, createMs, listMs, fullMs, full.getStatus(), full.getFilesWritten(), incrementalMs,
                incremental.getStatus(), incremental.getFilesWritten(), unselectedMs,
                unselected.getStatus(), unselected.getFilesWritten(), renameMs);
        System.out.println("SFD_BENCH " + summary);
        Files.writeString(Path.of("build", "dataset-benchmark.txt"), summary + System.lineSeparator(), StandardCharsets.UTF_8);
        assertThat(full.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(incremental.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(unselected.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(unselected.getFilesWritten()).isLessThan(incremental.getFilesWritten());
    }

    /**
     * M25.2.3: {@code SF_PERF_RECORDS} records spread round-robin over 10 record sets of one dataset (each set selects
     * its leads, {@code sort "-level,name"}, {@code limit 20} — the dataset loop's query above), and
     * {@code SF_PERF_PAGES} pages, each rendering one set: even pages in the value form through the dataset's record
     * template, odd pages with a narrowing loop. A FULL generation, then INCREMENTAL ones after editing one lead (the
     * pages of its set rebuild), one developer (the set's query filters it out: nothing rebuilds) and the record
     * template (the value-form pages rebuild).
     */
    @Test
    void recordsInSetsRenderedByPages() throws Exception {
        int records = Integer.parseInt(env("SF_PERF_RECORDS", "5000"));
        int pages = Integer.parseInt(env("SF_PERF_PAGES", "500"));
        int sets = 10;

        AppUser user = userService.create("rsbench-user", "rsbench-user@example.com", "Record Set Bench", "password-1234");
        Project project = projectService.create(
                new CreateProjectRequest("rsbench", "Record Set Benchmark", null, null), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "record set benchmark");

        DatasetView team = datasetService.create(
                new CreateDatasetCommand(project.getId(), null, "Team", CdlSources.split(SCHEMA), "name", null,
                        Map.of("html", "<li>$CMS_VALUE(name)$ ($CMS_VALUE(level)$)</li>")),
                ctx);
        List<UUID> setUuids = new ArrayList<>(sets);
        for (int k = 0; k < sets; k++) {
            setUuids.add(recordSetService.create(new CreateRecordSetCommand(project.getId(), null, team.uuid(), "set" + k,
                            "Set " + k, new RecordSetQuery("role == 'lead'", "-level,name", 20, null)), ctx)
                    .uuid());
        }
        long start = System.nanoTime();
        com.acme.staticforge.asset.dataset.RecordDetail lead = null;
        com.acme.staticforge.asset.dataset.RecordDetail developer = null;
        for (int i = 0; i < records; i++) {
            // Every fifth record of each set is a lead.
            ObjectNode content = mapper.createObjectNode()
                    .put("name", "Member " + i)
                    .put("role", (i / sets) % 5 == 0 ? "lead" : "dev")
                    .put("level", i % 7);
            var created = recordService.create(
                    new CreateRecordCommand(project.getId(), setUuids.get(i % sets), content), ctx).record();
            if (i == 0) {
                lead = created;
            } else if (i == sets) {
                developer = created; // in set0, like the lead
            }
        }
        long createMs = millisSince(start);

        List<TemplateView> templates = new ArrayList<>(2 * sets);
        for (int k = 0; k < sets; k++) {
            templates.add(templateService.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE,
                    "Set " + k + " value", CdlSources.split(""), Map.of("html", "<ul>$CMS_VALUE(recordset:set" + k + ")$</ul>"), null, false,
                    Map.of("html", "{displayNameSlug}.{ext}")), ctx));
            templates.add(templateService.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE,
                    "Set " + k + " loop", CdlSources.split(""), Map.of("html", "<ol>$CMS_FOR(m : recordset:set" + k + ", where=\"m.level > 2\")$"
                            + "<li>$CMS_VALUE(m.name)$</li>$CMS_END_FOR$</ol>"), null, false,
                    Map.of("html", "{displayNameSlug}.{ext}")), ctx));
        }
        for (int i = 0; i < pages; i++) {
            pageService.create(new CreatePageCommand("Page " + i, null, templates.get(i % templates.size()).uuid()), ctx);
        }
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));

        start = System.nanoTime();
        GenerationRun full = generate(project, target, user, GenerationMode.FULL);
        long fullMs = millisSince(start);

        recordService.update(lead.uuid(), mapper.createObjectNode().put("name", "Member zero").put("role", "lead").put("level", 6), lead.revision(), ctx);
        start = System.nanoTime();
        GenerationRun incremental = generate(project, target, user, GenerationMode.INCREMENTAL);
        long incrementalMs = millisSince(start);

        recordService.update(developer.uuid(),
                mapper.createObjectNode().put("name", "Member ten").put("role", "dev").put("level", 3), developer.revision(), ctx);
        start = System.nanoTime();
        GenerationRun unselected = generate(project, target, user, GenerationMode.INCREMENTAL);
        long unselectedMs = millisSince(start);

        DatasetView current = datasetService.find(project.getId(), team.uuid(), null).orElseThrow();
        datasetService.update(team.uuid(), new UpdateDatasetCommand("Team", CdlSources.split(SCHEMA), "name", null,
                Map.of("html", "<li class=\"member\">$CMS_VALUE(name)$</li>")), current.revision(), ctx);
        start = System.nanoTime();
        GenerationRun recordTemplate = generate(project, target, user, GenerationMode.INCREMENTAL);
        long recordTemplateMs = millisSince(start);

        String summary = String.format(
                "records=%d, sets=%d, pages=%d, createMs=%d, fullMs=%d (%s, %d files), incrementalMs=%d (%s, %d files),"
                        + " unselectedIncrementalMs=%d (%s, %d files), recordTemplateIncrementalMs=%d (%s, %d files)",
                records, sets, pages, createMs, fullMs, full.getStatus(), full.getFilesWritten(), incrementalMs,
                incremental.getStatus(), incremental.getFilesWritten(), unselectedMs, unselected.getStatus(),
                unselected.getFilesWritten(), recordTemplateMs, recordTemplate.getStatus(), recordTemplate.getFilesWritten());
        System.out.println("SFRS_BENCH " + summary);
        Files.writeString(Path.of("build", "record-set-benchmark.txt"), summary + System.lineSeparator(), StandardCharsets.UTF_8);
        assertThat(full.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(incremental.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(unselected.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(recordTemplate.getStatus()).isEqualTo(RunStatus.SUCCESS);
        assertThat(incremental.getFilesWritten()).isLessThan(full.getFilesWritten());
        assertThat(unselected.getFilesWritten()).isLessThan(incremental.getFilesWritten());
    }

    private GenerationRun generate(Project project, GenerationTarget target, AppUser user, GenerationMode mode)
            throws InterruptedException {
        releaseFixtures.releaseAll(project.getKey());
        GenerationRun started = generationService.start(
                project.getKey(),
                new GenerationRequest(mode, null, List.of("html"), target.getId(), null, null, null, null),
                user.getId());
        long deadline = System.currentTimeMillis() + 600_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(project.getKey(), started.getId());
            if (run.getStatus() == RunStatus.SUCCESS || run.getStatus() == RunStatus.PARTIAL
                    || run.getStatus() == RunStatus.FAILED || run.getStatus() == RunStatus.CANCELLED) {
                return run;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("generation did not finish");
    }

    private static long millisSince(long start) {
        return (System.nanoTime() - start) / 1_000_000;
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
