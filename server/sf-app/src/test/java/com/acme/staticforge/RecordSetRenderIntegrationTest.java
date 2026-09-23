package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.CreateRecordSetCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordDetail;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.RecordSetView;
import com.acme.staticforge.asset.dataset.UpdateDatasetCommand;
import com.acme.staticforge.asset.dataset.UpdateRecordSetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.preview.PagePreview;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * {@code M25.2.2} end to end: {@code $CMS_VALUE(recordset:uid)$}, a set loop with narrowing, and a {@code reference}
 * editor pointing at a set render the same bytes in FULL generation and in preview; a set whose stored query breaks
 * renders empty with {@code SF-GEN-0240} in both (the open criterion of {@code M25.1.2}); soft-deleted records never
 * render; time travel renders the set's query, membership and record values of that revision; template save,
 * CDL and page content validation know record sets.
 */
@SpringBootTest
@ActiveProfiles("test")
class RecordSetRenderIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String TEAM_CDL =
            """
            content {
              editor text name { label "Name" required }
              editor select role { label "Role" options [ { value "lead", label "Lead" }, { value "dev", label "Developer" } ] }
              editor date joined { label "Joined" }
            }
            """;

    private static final String RECORD_TEMPLATE = "<li>$CMS_VALUE(name)$ ($CMS_VALUE(_index)$/$CMS_VALUE(_count)$)</li>";

    private static final String PAGE_CDL =
            "content { editor reference featured { label \"Featured\" assetTypes [RECORD_SET] dataset \"team\" } }";

    private static final String PAGE_HTML =
            "<section>$CMS_VALUE(recordset:leads)$</section><p>$CMS_VALUE(recordset:leads._count)$</p>"
                    + "<ol>$CMS_FOR(m : recordset:leads, where=\"m.name != 'Dee'\")$<li>$CMS_VALUE(m.name)$</li>$CMS_END_FOR$</ol>"
                    + "<div>$CMS_VALUE(featured)$|$CMS_VALUE(featured._count)$|"
                    + "$CMS_FOR(m : featured, sort=\"-name\", limit=1)$$CMS_VALUE(m.name)$$CMS_END_FOR$</div>";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m25-recordset-render-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired PageRenderService pageRenderService;
    @Autowired RevisionRepository revisionRepository;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void generationAndPreviewRenderSetsIdenticallyThroughEveryChangeAndRevision() throws Exception {
        Fixture fx = newFixture();
        Site site = site(fx);

        // 1. FULL generation and preview produce the same bytes.
        GenerationTarget target = createTarget(fx.project());
        String expected = "<section><li>Ada (0/2)</li><li>Dee (1/2)</li></section><p>2</p><ol><li>Ada</li></ol>"
                + "<div><li>Bob (0/2)</li><li>Cy (1/2)</li>|2|Cy</div>";
        GenerationRun full = generate(fx, target);
        assertThat(full.getStatus()).as("diagnostics: %s", full.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(output(fx, target, full)).isEqualTo(expected);
        PagePreview preview = preview(fx, site.page(), null);
        assertThat(preview.html()).isEqualTo(expected);
        assertThat(preview.warnings()).isEmpty();
        long beforeChanges = head(fx);

        // 2. A soft-deleted record never renders; a record edit shows; generation and preview agree.
        assetService.softDelete(site.dee().uuid(), false, fx.ctx());
        RecordDetail ada = recordService.find(fx.projectId(), site.ada().uuid(), null).orElseThrow();
        recordService.update(ada.uuid(), json("{\"name\":\"Ada L.\",\"role\":\"lead\",\"joined\":\"2021-03-01\"}"), null,
                ada.revision(), fx.ctx());
        String afterEdits = "<section><li>Ada L. (0/1)</li></section><p>1</p><ol><li>Ada L.</li></ol>"
                + "<div><li>Bob (0/2)</li><li>Cy (1/2)</li>|2|Cy</div>";
        GenerationRun edited = generate(fx, target);
        assertThat(output(fx, target, edited)).isEqualTo(afterEdits);
        assertThat(preview(fx, site.page(), null).html()).isEqualTo(afterEdits);

        // 3. A query change and a record moved into the set.
        RecordSetView leads = recordSetService.find(fx.projectId(), site.leads(), null).orElseThrow();
        recordSetService.update(site.leads(), new UpdateRecordSetCommand(null, new RecordSetQuery(null, "name", null, null)),
                leads.revision(), fx.ctx());
        assetService.move(site.bob().uuid(), site.leads(), fx.ctx());
        String afterQuery = "<section><li>Ada L. (0/3)</li><li>Bob (1/3)</li><li>Eve (2/3)</li></section><p>3</p>"
                + "<ol><li>Ada L.</li><li>Bob</li><li>Eve</li></ol><div><li>Cy (0/1)</li>|1|Cy</div>";
        assertThat(output(fx, target, generate(fx, target))).isEqualTo(afterQuery);
        assertThat(preview(fx, site.page(), null).html()).isEqualTo(afterQuery);

        // 4. Time travel renders the query, membership and record values of that revision.
        assertThat(preview(fx, site.page(), beforeChanges).html()).isEqualTo(expected);

        // 5. A schema change that breaks the stored query: the set renders nothing, with SF-GEN-0240 in both.
        recordSetService.update(site.leads(), new UpdateRecordSetCommand(null, new RecordSetQuery(null, "-joined", null, null)),
                recordSetService.find(fx.projectId(), site.leads(), null).orElseThrow().revision(), fx.ctx());
        long beforeBreak = head(fx);
        DatasetView team = datasetService.find(fx.projectId(), site.team().uuid(), null).orElseThrow();
        DatasetView broken = datasetService.update(
                team.uuid(),
                new UpdateDatasetCommand("Team", TEAM_CDL.replace("editor date joined { label \"Joined\" }", ""), "name", null),
                team.revision(),
                fx.ctx());
        assertThat(broken.brokenRecordSets()).extracting(b -> b.uid()).containsExactly("leads");
        String emptyLeads = "<section></section><p>0</p><ol></ol><div><li>Cy (0/1)</li>|1|Cy</div>";
        GenerationRun afterBreak = generate(fx, target);
        // A warning-only build publishes and reports PARTIAL.
        assertThat(afterBreak.getStatus()).as("diagnostics: %s", afterBreak.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        assertThat(output(fx, target, afterBreak)).isEqualTo(emptyLeads);
        assertThat(afterBreak.getDiagnostics().toString())
                .contains(DiagnosticCodes.GEN_RECORD_SET_QUERY_INVALID)
                .contains("leads");
        PagePreview brokenPreview = preview(fx, site.page(), null);
        assertThat(brokenPreview.html()).isEqualTo(emptyLeads);
        assertThat(brokenPreview.warnings()).extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.GEN_RECORD_SET_QUERY_INVALID);
        // Before the schema change the same set rendered its records.
        assertThat(preview(fx, site.page(), beforeBreak).html()).startsWith("<section><li>Eve (0/3)</li>");
    }

    @Test
    void templateSaveKnowsRecordSets() {
        Fixture fx = newFixture();
        site(fx);

        assertThatThrownBy(() -> section(fx, "$CMS_VALUE(recordset:nope)$"))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(errorCodes(ex))
                        .containsExactly(DiagnosticCodes.OCTL_UNRESOLVABLE_REF));
        assertThatThrownBy(() -> section(fx, "$CMS_FOR(m : recordset:leads, folder=\"team\")$x$CMS_END_FOR$"))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(errorCodes(ex))
                        .containsExactly(DiagnosticCodes.OCTL_DATASET_QUERY));
        assertThatThrownBy(() -> section(fx, "$CMS_FOR(m : recordset:leads, where=\"m.nope == 1\")$x$CMS_END_FOR$"))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(errorCodes(ex))
                        .containsExactly(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD));
        TemplateView ok = section(fx, "$CMS_VALUE(recordset:leads)$$CMS_FOR(m : recordset:leads, where=\"m.role == 'lead'\")$"
                + "$CMS_VALUE(m.name)$$CMS_END_FOR$");
        assertThat(ok.uuid()).isNotNull();
    }

    @Test
    void aReferenceEditorRestrictedToADatasetAcceptsOnlyThatDatasetsSets() throws Exception {
        Fixture fx = newFixture();
        Site site = site(fx);

        assertThatThrownBy(() -> pageTemplate(fx, "Wrong", "content { editor reference x { label \"X\" assetTypes [PAGE] dataset \"team\" } }",
                        "x"))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(errorCodes(ex))
                        .containsExactly(DiagnosticCodes.CDL_INVALID_ATTRIBUTE));

        DatasetView faq = datasetService.create(
                new CreateDatasetCommand(fx.projectId(), null, "FAQ", "content { editor text q { label \"Q\" } }", null, null),
                fx.ctx());
        RecordSetView questions = recordSetService.create(
                new CreateRecordSetCommand(fx.projectId(), null, faq.uuid(), "questions", "Questions", RecordSetQuery.ALL), fx.ctx());

        AssetVersionView page = assetService.requireCurrent(fx.projectId(), site.page());
        ObjectNode payload = page.payload().deepCopy();
        ((ObjectNode) payload.path("content")).set("featured", setRef(questions.uuid()));
        assertThatThrownBy(() -> pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(issues(ex)).singleElement().satisfies(issue -> {
                        assertThat(issue.path()).isEqualTo("content.featured");
                        assertThat(issue.code()).isEqualTo("dataset");
                        assertThat(issue.severity()).isEqualTo(Severity.ERROR);
                    });
                });
    }

    // ------------------------------------------------------------------
    // Fixture
    // ------------------------------------------------------------------

    /**
     * Dataset {@code team} with an html record template; sets {@code leads} (role lead, newest first: Ada, Dee; Eve is
     * a dev in it) and {@code staff} (Bob, Cy) in a Content folder; a page whose template renders {@code leads} as a
     * value and a narrowed loop, and its {@code featured} reference editor → {@code staff}.
     */
    private Site site(Fixture fx) {
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(fx.projectId(), null, "Team", TEAM_CDL, "name", null, Map.of("html", RECORD_TEMPLATE)),
                fx.ctx());
        AssetVersionView folder = folderService.create(null, "Team", FolderScope.CONTENT, fx.ctx());
        UUID leads = recordSetService.create(new CreateRecordSetCommand(fx.projectId(), folder.uuid(), team.uuid(), "leads",
                        "Leads", new RecordSetQuery("role == 'lead'", "-joined", null, null)), fx.ctx())
                .uuid();
        UUID staff = recordSetService.create(new CreateRecordSetCommand(fx.projectId(), folder.uuid(), team.uuid(), "staff",
                        "Staff", RecordSetQuery.ALL), fx.ctx())
                .uuid();
        RecordDetail ada = record(fx, leads, "{\"name\":\"Ada\",\"role\":\"lead\",\"joined\":\"2021-03-01\"}");
        RecordDetail dee = record(fx, leads, "{\"name\":\"Dee\",\"role\":\"lead\",\"joined\":\"2019-05-05\"}");
        record(fx, leads, "{\"name\":\"Eve\",\"role\":\"dev\",\"joined\":\"2024-02-02\"}");
        RecordDetail bob = record(fx, staff, "{\"name\":\"Bob\",\"role\":\"dev\",\"joined\":\"2023-07-15\"}");
        record(fx, staff, "{\"name\":\"Cy\",\"role\":\"dev\",\"joined\":\"2022-11-30\"}");

        TemplateView template = pageTemplate(fx, "Team Page", PAGE_CDL, PAGE_HTML);
        AssetVersionView page = pageService.create(new CreatePageCommand("Team", null, template.uuid()), fx.ctx());
        ObjectNode payload = page.payload().deepCopy();
        payload.putObject("content").set("featured", setRef(staff));
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());
        return new Site(team, leads, staff, ada, dee, bob, page.uuid());
    }

    private record Site(DatasetView team, UUID leads, UUID staff, RecordDetail ada, RecordDetail dee, RecordDetail bob, UUID page) {}

    private RecordDetail record(Fixture fx, UUID set, String content) {
        return recordService.create(new CreateRecordCommand(fx.projectId(), set, null, json(content)), fx.ctx()).record();
    }

    private ObjectNode setRef(UUID set) {
        return mapper.createObjectNode().put("type", "ASSET_REF").put("uuid", set.toString()).put("assetType", "RECORD_SET");
    }

    private TemplateView pageTemplate(Fixture fx, String name, String cdl, String html) {
        return templateService.create(
                new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE, name, cdl,
                        Map.of("html", html), null, false, Map.of("html", "{displayNameSlug}.{ext}")),
                fx.ctx());
    }

    private TemplateView section(Fixture fx, String html) {
        return templateService.create(
                new CreateTemplateCommand(fx.projectId(), AssetType.SECTION_TEMPLATE, "Section " + SEQ.incrementAndGet(), "",
                        Map.of("html", html), null, false, Map.of()),
                fx.ctx());
    }

    private PagePreview preview(Fixture fx, UUID page, Long revision) {
        return pageRenderService.renderPage(fx.projectId(), page, revision, "html", false, null, null, null);
    }

    private long head(Fixture fx) {
        return revisionRepository.findHeadRevisionId(fx.projectId()).orElseThrow();
    }

    private com.fasterxml.jackson.databind.JsonNode json(String content) {
        try {
            return mapper.readTree(content);
        } catch (IOException e) {
            throw new IllegalArgumentException(e);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<String> errorCodes(SfException ex) {
        return ((List<Diagnostic>) ex.getProblem().getExtensions().get("diagnostics")).stream()
                .filter(d -> d.severity() == Severity.ERROR)
                .map(Diagnostic::code)
                .toList();
    }

    @SuppressWarnings("unchecked")
    private static List<ContentIssue> issues(SfException ex) {
        return (List<ContentIssue>) ex.getProblem().getExtensions().get("issues");
    }

    private GenerationTarget createTarget(Project project) throws IOException {
        return targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
    }

    private GenerationRun generate(Fixture fx, GenerationTarget target) throws InterruptedException {
        GenerationRun started = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, null),
                fx.user().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(fx.project().getKey(), started.getId());
            RunStatus status = run.getStatus();
            if (status == RunStatus.SUCCESS || status == RunStatus.PARTIAL || status == RunStatus.FAILED
                    || status == RunStatus.CANCELLED) {
                return run;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not reach a terminal state within 60s");
    }

    private String output(Fixture fx, GenerationTarget target, GenerationRun run) throws IOException {
        Path file = TargetLocations.resolve(outputRoot, fx.project().getKey(), target)
                .resolve("builds")
                .resolve(String.valueOf(run.getId()))
                .resolve("team.html");
        assertThat(Files.isRegularFile(file)).as("%s exists", file).isTrue();
        return Files.readString(file);
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "m25render-user-" + n, "m25render-user-" + n + "@example.com", "M25 Render User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("m25renderp_" + n, "M25 Render Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        long projectId() {
            return project.getId();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
