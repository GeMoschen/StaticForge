package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordDetail;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.UpdateDatasetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * {@code M19.5.2} — the epic's closing journey: a dataset schema, records in two Content folders, a
 * section template looping the dataset with {@code where}/{@code sort}, a page referencing one
 * record, FULL then INCREMENTAL generation, a {@code renamedFrom} schema change, preview and time
 * travel, and finally an export/import into a new project that generates the identical site.
 *
 * <p>The pieces are proven in isolation elsewhere ({@code DatasetRecordIntegrationTest},
 * {@code DatasetApiTest}, {@code DatasetIncrementalPlanIntegrationTest}, the dataset golden files);
 * this test is where their seams show: media reached only through a record is copied, a record edit
 * reaches the looping page over template → dataset edges, and the imported project renders the same
 * bytes.
 */
@SpringBootTest
@ActiveProfiles("test")
class M19ContentStoreJourneyIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String TEAM_CDL =
            """
            content {
              editor text name { label "Name" required }
              editor select role { label "Role" options [ { value "lead", label "Lead" }, { value "dev", label "Developer" } ] }
              editor date joined { label "Joined" }
              editor media photo { label "Photo" }
            }
            """;

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m19-journey-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired MediaService mediaService;
    @Autowired FolderService folderService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired SnapshotService snapshotService;
    @Autowired BuildPlanner buildPlanner;
    @Autowired PageRenderService pageRenderService;
    @Autowired RevisionRepository revisionRepository;
    @Autowired ProjectExportImportService exportImportService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void datasetFromSchemaThroughIncrementalPublishRenameAndExportImport() throws Exception {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();

        // 1. Schema, four records in two folders, one photo reached only through a record.
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(projectId, null, "Team", TEAM_CDL, "name", "Our people"), fx.ctx());
        AssetVersionView ada = mediaService.upload(projectId, null, "ada.png", "image/png", solidPng(Color.RED), fx.ctx());
        AssetVersionView staff = folderService.create(null, "Staff", FolderScope.CONTENT, fx.ctx());
        AssetVersionView alumni = folderService.create(null, "Alumni", FolderScope.CONTENT, fx.ctx());
        RecordDetail adaRecord = record(fx, team, staff.uuid(),
                "{\"name\":\"Ada\",\"role\":\"lead\",\"joined\":\"2021-03-01\",\"photo\":{\"type\":\"MEDIA_REF\",\"uuid\":\"" + ada.uuid() + "\"}}");
        RecordDetail bob = record(fx, team, staff.uuid(), "{\"name\":\"Bob\",\"role\":\"dev\",\"joined\":\"2023-07-15\"}");
        record(fx, team, staff.uuid(), "{\"name\":\"Cy\",\"role\":\"lead\",\"joined\":\"2022-11-30\"}");
        record(fx, team, alumni.uuid(), "{\"name\":\"Dee\",\"role\":\"lead\",\"joined\":\"2019-05-05\"}");

        // 2. A section looping the leads, a page including it, a profile page referencing a record,
        //    and an unrelated page.
        TemplateView leadsSection = templateService.create(
                new CreateTemplateCommand(projectId, AssetType.SECTION_TEMPLATE, "Leads", "",
                        Map.of("html", leadsSource("role")), null, false, Map.of()),
                fx.ctx());
        TemplateView teamTemplate = pageTemplate(fx, "Team Page", "", "<main>$CMS_INCLUDE(section_template:leads)$</main>");
        TemplateView profileTemplate = pageTemplate(fx, "Profile",
                "content { editor reference person { label \"Person\" dataset \"team\" } }",
                "<h1>$CMS_VALUE(person.name)$</h1><p>$CMS_VALUE(person.role)$ since $CMS_VALUE(person.joined)$ in $CMS_VALUE(person._folderPath)$</p>");
        TemplateView plainTemplate = pageTemplate(fx, "Plain", "", "<p>legal</p>");
        AssetVersionView teamPage = pageService.create(new CreatePageCommand("Team", null, teamTemplate.uuid()), fx.ctx());
        AssetVersionView profile = pageService.create(new CreatePageCommand("Ada", null, profileTemplate.uuid()), fx.ctx());
        ObjectNode profilePayload = profile.payload().deepCopy();
        profilePayload.putObject("content").putObject("person")
                .put("type", "ASSET_REF").put("uuid", adaRecord.uuid().toString()).put("assetType", "RECORD");
        pageService.update(profile.uuid(), profilePayload, profile.validFromRevision(), fx.ctx());
        AssetVersionView legal = pageService.create(new CreatePageCommand("Legal", null, plainTemplate.uuid()), fx.ctx());

        // 3. FULL generation.
        GenerationTarget target = createTarget(fx.project());
        GenerationRun full = generate(fx.project(), target, fx.user(), GenerationMode.FULL);
        assertThat(full.getStatus()).as("diagnostics: %s", full.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Path fullBuild = buildDir(fx.project(), target, full);
        String photoPath = "assets/media/" + ada.uid() + ".png";
        assertThat(output(fullBuild, "team.html")).isEqualTo(
                "<main><ul>"
                        + "<li>Cy (2022-11-30)</li>"
                        + "<li><img src=\"" + photoPath + "\" alt=\"\">Ada (2021-03-01)</li>"
                        + "</ul></main>");
        assertThat(output(fullBuild, "ada.html")).isEqualTo("<h1>Ada</h1><p>lead since 2021-03-01 in /staff/</p>");
        assertThat(fullBuild.resolve(photoPath)).as("media reached only through a record is copied").exists();

        // 4. Preview renders the same bytes as generation for a page without links.
        assertThat(pageRenderService.renderPage(projectId, profile.uuid(), null, "html", false))
                .isEqualTo(output(fullBuild, "ada.html"));

        // 5. Editing a non-lead record rebuilds the looping page (dataset dependency), not the others.
        long beforeBobEdit = head(fx.project());
        RecordDetail editedBob = recordService.update(
                        bob.uuid(), json("{\"name\":\"Bob\",\"role\":\"lead\",\"joined\":\"2024-01-01\"}"), null, bob.revision(), fx.ctx())
                .record();
        assertThat(planned(fx.project(), beforeBobEdit)).containsExactly(teamPage.uuid());
        GenerationRun incremental = generate(fx.project(), target, fx.user(), GenerationMode.INCREMENTAL);
        assertThat(incremental.getStatus()).as("diagnostics: %s", incremental.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(output(buildDir(fx.project(), target, incremental), "team.html"))
                .startsWith("<main><ul><li>Bob (2024-01-01)</li>");

        // 6. Time travel: before the edit, Bob was no lead.
        assertThat(pageRenderService.renderPage(projectId, teamPage.uuid(), beforeBobEdit, "html", false))
                .doesNotContain("Bob");
        assertThat(pageRenderService.renderPage(projectId, teamPage.uuid(), null, "html", false)).contains("Bob (2024-01-01)");

        // 7. Rename role → position: one revision for the dataset and every record holding a role; the
        //    template still says member.role, so the loop selects nobody until the template follows.
        long revisionsBefore = revisionCount(fx.project());
        DatasetView renamed = datasetService.update(
                team.uuid(),
                new UpdateDatasetCommand("Team", TEAM_CDL.replace("editor select role { label \"Role\"",
                        "editor select position { label \"Position\" renamedFrom \"role\""), "name", "Our people"),
                datasetService.find(projectId, team.uuid(), null).orElseThrow().revision(),
                fx.ctx());
        assertThat(revisionCount(fx.project())).isEqualTo(revisionsBefore + 1);
        assertThat(recordService.find(projectId, editedBob.uuid(), null).orElseThrow().content().path("position").asText())
                .isEqualTo("lead");
        assertThat(pageRenderService.renderPage(projectId, teamPage.uuid(), null, "html", false)).isEqualTo("<main><ul></ul></main>");

        templateService.saveChannel(
                leadsSection.uuid(), "html", leadsSource("position"),
                assetService.requireCurrent(projectId, leadsSection.uuid()).validFromRevision(), fx.ctx());
        GenerationRun afterRename = generate(fx.project(), target, fx.user(), GenerationMode.FULL);
        assertThat(afterRename.getStatus()).as("diagnostics: %s", afterRename.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Path renamedBuild = buildDir(fx.project(), target, afterRename);
        assertThat(output(renamedBuild, "team.html")).startsWith("<main><ul><li>Bob (2024-01-01)</li>");
        assertThat(renamed.revision()).isGreaterThan(beforeBobEdit);

        // 8. Export the whole project, import into a new one: the generated site is identical.
        byte[] archive = exportImportService.exportProject(projectId);
        Fixture copy = newFixture();
        exportImportService.importProject(copy.project().getId(), archive, copy.ctx(), ImportOptions.DEFAULT);
        // The archive carries the target; reuse it rather than adding a second default.
        GenerationTarget copyTarget = targetRepository.findByProjectId(copy.project().getId()).stream()
                .findFirst()
                .orElseThrow();
        GenerationRun copied = generate(copy.project(), copyTarget, copy.user(), GenerationMode.FULL);
        assertThat(copied.getStatus()).as("diagnostics: %s", copied.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        Path copiedBuild = buildDir(copy.project(), copyTarget, copied);
        for (String file : List.of("team.html", "ada.html", "legal.html", photoPath)) {
            assertThat(Files.readAllBytes(copiedBuild.resolve(file))).as(file).isEqualTo(Files.readAllBytes(renamedBuild.resolve(file)));
        }
        assertThat(legal.uuid()).isNotNull();
    }

    private static String leadsSource(String roleField) {
        return "<ul>$CMS_FOR(member : dataset:team, where=\"member." + roleField + " == 'lead'\", sort=\"-joined\", folder=\"staff\")$"
                + "<li>$CMS_IF(member.photo)$<img src=\"$CMS_REF(member.photo)$\" alt=\"\">$CMS_END_IF$"
                + "$CMS_VALUE(member.name)$ ($CMS_VALUE(member.joined)$)</li>$CMS_END_FOR$</ul>";
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** A record in the record set of {@code dataset} in {@code folder} (M25: records always live in a set). */
    private RecordDetail record(Fixture fx, DatasetView dataset, UUID folder, String content) throws IOException {
        UUID set = new RecordSetFixtures(recordSetService).setFor(fx.project().getId(), dataset.uuid(), folder, fx.ctx());
        return recordService.create(new CreateRecordCommand(fx.project().getId(), set, null, mapper.readTree(content)), fx.ctx())
                .record();
    }

    private JsonNode json(String content) throws IOException {
        return mapper.readTree(content);
    }

    private TemplateView pageTemplate(Fixture fx, String name, String cdl, String html) {
        return templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE, name, cdl,
                        Map.of("html", html), null, false, Map.of("html", "{displayNameSlug}.{ext}")),
                fx.ctx());
    }

    private Set<UUID> planned(Project project, long lastSuccessfulRevision) {
        OutputPathResolver paths = mock(OutputPathResolver.class);
        when(paths.resolvePagePath(any(), any())).thenAnswer(call -> call.getArgument(0).toString());
        BuildPlan plan = buildPlanner.plan(
                snapshotService.snapshot(project.getId(), null), GenerationMode.INCREMENTAL, lastSuccessfulRevision,
                Set.of("html"), null, null, paths);
        return plan.entries().stream().map(PlanEntry::pageUuid).collect(Collectors.toSet());
    }

    private long head(Project project) {
        return snapshotService.snapshot(project.getId(), null).revision();
    }

    private long revisionCount(Project project) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(project.getId()).size();
    }

    private GenerationTarget createTarget(Project project) throws IOException {
        return targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
    }

    private GenerationRun generate(Project project, GenerationTarget target, AppUser user, GenerationMode mode)
            throws InterruptedException {
        GenerationRun started = generationService.start(
                project.getKey(),
                new GenerationRequest(mode, null, List.of("html"), target.getId(), null, null, null, null),
                user.getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(project.getKey(), started.getId());
            RunStatus status = run.getStatus();
            if (status == RunStatus.SUCCESS || status == RunStatus.PARTIAL || status == RunStatus.FAILED
                    || status == RunStatus.CANCELLED) {
                return run;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not reach a terminal state within 60s");
    }

    private Path buildDir(Project project, GenerationTarget target, GenerationRun run) {
        return TargetLocations.resolve(outputRoot, project.getKey(), target).resolve("builds").resolve(String.valueOf(run.getId()));
    }

    private static String output(Path buildDir, String fileName) throws IOException {
        Path file = buildDir.resolve(fileName);
        assertThat(Files.isRegularFile(file)).as("%s exists in %s", fileName, buildDir).isTrue();
        return Files.readString(file);
    }

    private static byte[] solidPng(Color color) {
        BufferedImage image = new BufferedImage(32, 32, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        g.setColor(color);
        g.fillRect(0, 0, 32, 32);
        g.dispose();
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(image, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "m19journey-user-" + n, "m19journey-user-" + n + "@example.com", "M19 Journey User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("m19journeyp_" + n, "M19 Journey Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
