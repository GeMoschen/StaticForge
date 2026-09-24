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
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
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
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@code M19.3.2}: incremental planning over datasets, proven on the planner's output rather than by
 * inspection. A record change rebuilds the pages that reference the record and the pages whose dataset
 * loops may select it before or after the change — never the pages that only reference its siblings or
 * loop past it.
 */
@SpringBootTest
@ActiveProfiles("test")
class DatasetIncrementalPlanIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String TEAM_CDL =
            "content { editor text name { label \"Name\" } editor text role { label \"Role\" } }";

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired FolderService folderService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;
    @Autowired SnapshotService snapshotService;
    @Autowired BuildPlanner buildPlanner;
    @Autowired PageRenderService pageRenderService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void recordAndSchemaChangesRebuildExactlyTheDependentPages() {
        Fixture fx = newFixture();
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Team", TEAM_CDL, "name", null), fx.ctx());
        RecordDetail jane = record(fx, team, "{\"name\":\"Jane\",\"role\":\"lead\"}");
        RecordDetail joe = record(fx, team, "{\"name\":\"Joe\",\"role\":\"dev\"}");

        TemplateView leadsLoop = pageTemplate(fx, "Leads", "",
                "<ul>$CMS_FOR(m : dataset:team, where=\"m.role == 'lead'\")$<li>$CMS_VALUE(m.name)$</li>$CMS_END_FOR$</ul>");
        TemplateView everyoneLoop = pageTemplate(fx, "Everyone", "",
                "$CMS_FOR(m : dataset:team, sort=\"name\", limit=1)$$CMS_VALUE(m.name)$$CMS_END_FOR$");
        TemplateView scopeLoop = pageTemplate(fx, "Scoped", "",
                "$CMS_SET(wanted = 'lead')$$CMS_FOR(m : dataset:team, where=\"m.role == wanted\")$$CMS_VALUE(m.name)$$CMS_END_FOR$");
        TemplateView profile = pageTemplate(fx, "Profile",
                "content { editor reference person { label \"Person\" dataset \"team\" } }",
                "<p>$CMS_VALUE(person.name)$</p>");
        TemplateView plain = pageTemplate(fx, "Plain", "", "<p>plain</p>");

        UUID leads = pageService.create(new CreatePageCommand("Team leads", null, leadsLoop.uuid()), fx.ctx()).uuid();
        UUID everyone = pageService.create(new CreatePageCommand("Everyone", null, everyoneLoop.uuid()), fx.ctx()).uuid();
        UUID scoped = pageService.create(new CreatePageCommand("Scoped", null, scopeLoop.uuid()), fx.ctx()).uuid();
        UUID janeProfile = profilePage(fx, profile, "Jane Profile", jane);
        UUID legal = pageService.create(new CreatePageCommand("Legal", null, plain.uuid()), fx.ctx()).uuid();
        UUID joeProfile = profilePage(fx, profile, "Joe Profile", joe);

        // Editing a lead: the loops selecting leads, the unfiltered loop (a limit applies after the
        // filter), the loop whose where reads the render scope, and the page referencing the record.
        long baseline = head(fx);
        RecordDetail editedJane = recordService.update(
                        jane.uuid(), json("{\"name\":\"Jane D.\",\"role\":\"lead\"}"), jane.revision(), fx.ctx())
                .record();
        assertThat(planned(fx, baseline)).containsExactlyInAnyOrder(leads, everyone, scoped, janeProfile);

        // A new record the leads loop filters out doesn't rebuild it.
        baseline = head(fx);
        RecordDetail kim = record(fx, team, "{\"name\":\"Kim\",\"role\":\"dev\"}");
        assertThat(planned(fx, baseline)).containsExactlyInAnyOrder(everyone, scoped);

        // Promoting a record: it is selected after the change; demoting it: it was selected before.
        baseline = head(fx);
        RecordDetail promotedJoe = recordService.update(
                        joe.uuid(), json("{\"name\":\"Joe\",\"role\":\"lead\"}"), joe.revision(), fx.ctx())
                .record();
        assertThat(planned(fx, baseline)).containsExactlyInAnyOrder(leads, everyone, scoped, joeProfile);
        baseline = head(fx);
        RecordDetail demotedJoe = recordService.update(
                        joe.uuid(), json("{\"name\":\"Joe\",\"role\":\"dev\"}"), promotedJoe.revision(), fx.ctx())
                .record();
        assertThat(planned(fx, baseline)).containsExactlyInAnyOrder(leads, everyone, scoped, joeProfile);

        // A schema change reaches every loop over the dataset.
        baseline = head(fx);
        DatasetView current = datasetService.find(fx.project().getId(), team.uuid(), null).orElseThrow();
        datasetService.update(team.uuid(),
                new UpdateDatasetCommand("Team", TEAM_CDL.replace("\"Role\"", "\"Team role\""), "name", null),
                current.revision(), fx.ctx());
        assertThat(planned(fx, baseline)).containsExactlyInAnyOrder(leads, everyone, scoped);

        baseline = head(fx);
        AssetVersionView leadsFolder = folderService.create(null, "Leads", FolderScope.CONTENT, fx.ctx());
        UUID leadsSet = new RecordSetFixtures(recordSetService)
                .create(fx.project().getId(), team.uuid(), leadsFolder.uuid(), "Leads", fx.ctx())
                .uuid();
        assetService.move(editedJane.uuid(), leadsSet, fx.ctx());
        assertThat(planned(fx, baseline)).containsExactlyInAnyOrder(leads, everyone, scoped, janeProfile);

        // Deleting a record the leads loop never selected.
        baseline = head(fx);
        assetService.softDelete(kim.uuid(), true, fx.ctx());
        assertThat(planned(fx, baseline)).containsExactlyInAnyOrder(everyone, scoped).doesNotContain(legal);
        assertThat(demotedJoe.revision()).isPositive();

        // Deleting a selected record: it was selected before. It leaves every loop and reads empty;
        // time travel still sees it.
        long beforeDelete = head(fx);
        assertThat(render(fx, leads, null)).isEqualTo("<ul><li>Jane D.</li></ul>");
        assetService.softDelete(editedJane.uuid(), true, fx.ctx());
        assertThat(planned(fx, beforeDelete)).containsExactlyInAnyOrder(leads, everyone, scoped, janeProfile);
        assertThat(render(fx, leads, null)).isEqualTo("<ul></ul>");
        assertThat(render(fx, janeProfile, null)).isEqualTo("<p></p>");
        assertThat(render(fx, leads, beforeDelete)).isEqualTo("<ul><li>Jane D.</li></ul>");
        assertThat(render(fx, janeProfile, beforeDelete)).isEqualTo("<p>Jane D.</p>");
    }

    @Test
    void aChangeReachesALoopThroughTheReferencesOfTheRecordsItSelects() {
        Fixture fx = newFixture();
        DatasetView mentors = datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Mentors", TEAM_CDL, "name", null), fx.ctx());
        RecordDetail ada = record(fx, mentors, "{\"name\":\"Ada\",\"role\":\"mentor\"}");
        DatasetView team = datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Team",
                        "content { editor text name { label \"Name\" } editor text role { label \"Role\" }"
                                + " editor reference mentor { label \"Mentor\" dataset \"mentors\" } }",
                        "name", null),
                fx.ctx());
        String mentoredBy = ",\"mentor\":{\"type\":\"ASSET_REF\",\"uuid\":\"" + ada.uuid() + "\",\"assetType\":\"RECORD\"}}";
        record(fx, team, "{\"name\":\"Jane\",\"role\":\"lead\"" + mentoredBy);
        record(fx, team, "{\"name\":\"Joe\",\"role\":\"dev\"" + mentoredBy);

        TemplateView leadsLoop = pageTemplate(fx, "Leads", "",
                "$CMS_FOR(m : dataset:team, where=\"m.role == 'lead'\")$$CMS_VALUE(m.name)$ ($CMS_VALUE(m.mentor.name)$)$CMS_END_FOR$");
        TemplateView devsLoop = pageTemplate(fx, "Devs", "",
                "$CMS_FOR(m : dataset:team, where=\"m.role == 'dev'\", folder=\"interns\")$$CMS_VALUE(m.mentor.name)$$CMS_END_FOR$");
        UUID leads = pageService.create(new CreatePageCommand("Team leads", null, leadsLoop.uuid()), fx.ctx()).uuid();
        pageService.create(new CreatePageCommand("Interns", null, devsLoop.uuid()), fx.ctx());
        assertThat(render(fx, leads, null)).isEqualTo("Jane (Ada)");

        // Ada is in another dataset: only the loop selecting a record that references her renders her.
        long baseline = head(fx);
        recordService.update(ada.uuid(), json("{\"name\":\"Ada L.\",\"role\":\"mentor\"}"), ada.revision(), fx.ctx());
        assertThat(planned(fx, baseline)).containsExactly(leads);
        assertThat(render(fx, leads, null)).isEqualTo("Jane (Ada L.)");
    }

    private String render(Fixture fx, UUID page, Long revision) {
        return pageRenderService.renderPage(fx.project().getId(), page, revision, "html", false);
    }

    // ------------------------------------------------------------------

    private Set<UUID> planned(Fixture fx, long lastSuccessfulRevision) {
        OutputPathResolver paths = mock(OutputPathResolver.class);
        when(paths.resolvePagePath(any(), any())).thenAnswer(call -> call.getArgument(0).toString());
        BuildPlan plan = buildPlanner.plan(
                snapshotService.snapshot(fx.project().getId(), null),
                GenerationMode.INCREMENTAL,
                lastSuccessfulRevision,
                Set.of("html"),
                null,
                null,
                paths);
        return plan.entries().stream().map(PlanEntry::pageUuid).collect(Collectors.toSet());
    }

    private long head(Fixture fx) {
        return snapshotService.snapshot(fx.project().getId(), null).revision();
    }

    private UUID profilePage(Fixture fx, TemplateView profile, String name, RecordDetail person) {
        AssetVersionView page = pageService.create(new CreatePageCommand(name, null, profile.uuid()), fx.ctx());
        ObjectNode payload = page.payload().deepCopy();
        payload.putObject("content").putObject("person")
                .put("type", "ASSET_REF")
                .put("uuid", person.uuid().toString())
                .put("assetType", "RECORD");
        return pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx()).uuid();
    }

    private TemplateView pageTemplate(Fixture fx, String name, String cdl, String html) {
        return templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE, name, cdl,
                        Map.of("html", html), null, false, Map.of("html", "{displayNameSlug}.{ext}")),
                fx.ctx());
    }

    private RecordDetail record(Fixture fx, DatasetView dataset, String content) {
        return recordService.create(
                        new CreateRecordCommand(
                                fx.project().getId(),
                                new RecordSetFixtures(recordSetService).setFor(fx.project().getId(), dataset.uuid(), null, fx.ctx()),
                                json(content)),
                        fx.ctx())
                .record();
    }

    private JsonNode json(String content) {
        try {
            return mapper.readTree(content);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "dsplan-user-" + n, "dsplan-user-" + n + "@example.com", "Dataset Plan User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("dsplanp_" + n, "Dataset Plan Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
