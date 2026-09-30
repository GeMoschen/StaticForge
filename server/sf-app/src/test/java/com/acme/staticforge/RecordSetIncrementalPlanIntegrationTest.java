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
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.insight.RebuildEdgeKind;
import com.acme.staticforge.generate.insight.RebuildReason;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.generate.insight.RebuildStep;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.generate.snapshot.SnapshotView;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
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
 * {@code M25.2.3}: incremental planning over record sets, proven on the planner's output and its build insight
 * reasons. A record change rebuilds the readers of its set(s) only when the set's stored query (and a loop's
 * {@code where}) may select it before or after the change; a set change rebuilds every reader of the set; a record
 * template change only the readers rendering the records through it (the value form, a {@code reference} editor
 * value) — and nested set rendering through a record's reference editor is followed.
 */
@SpringBootTest
@ActiveProfiles("test")
class RecordSetIncrementalPlanIntegrationTest {

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
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired BuildPlanner buildPlanner;

    private final ObjectMapper mapper = new ObjectMapper();

    /**
     * The acceptance scenario: P1 renders {@code recordset:leads} ({@code where "role == 'lead'"}), P2 loops
     * {@code recordset:staff} (no set {@code where}), P3 renders {@code $CMS_VALUE(featured)$} with the reference editor
     * {@code featured → staff}, P4 loops {@code dataset:team}, P5 is unrelated.
     */
    @Test
    void recordSetAndRecordTemplateChangesRebuildExactlyTheReadingPages() {
        Fixture fx = newFixture();
        DatasetView team = datasetService.create(new CreateDatasetCommand(
                fx.projectId(), null, "Team", CdlSources.split(TEAM_CDL), "name", null, Map.of("html", "<li>$CMS_VALUE(name)$</li>")), fx.ctx());
        AssetVersionView folder = folderService.create(null, "Team", FolderScope.CONTENT, fx.ctx());
        RecordSetView leads = recordSetService.create(new CreateRecordSetCommand(fx.projectId(), folder.uuid(), team.uuid(),
                "leads", "Leads", new RecordSetQuery("role == 'lead'", null, null, null)), fx.ctx());
        RecordSetView staff = recordSetService.create(new CreateRecordSetCommand(fx.projectId(), folder.uuid(), team.uuid(),
                "staff", "Staff", RecordSetQuery.ALL), fx.ctx());
        RecordDetail jane = record(fx, leads.uuid(), "{\"name\":\"Jane\",\"role\":\"lead\"}");
        RecordDetail eve = record(fx, leads.uuid(), "{\"name\":\"Eve\",\"role\":\"dev\"}");
        RecordDetail ann = record(fx, staff.uuid(), "{\"name\":\"Ann\",\"role\":\"lead\"}");
        record(fx, staff.uuid(), "{\"name\":\"Bob\",\"role\":\"dev\"}");

        TemplateView t1 = pageTemplate(fx, "Leads", "", "<ul>$CMS_VALUE(recordset:leads)$</ul>");
        TemplateView t2 = pageTemplate(fx, "Staff", "",
                "<ol>$CMS_FOR(m : recordset:staff)$<li>$CMS_VALUE(m.name)$</li>$CMS_END_FOR$</ol>");
        TemplateView t3 = pageTemplate(fx, "Featured",
                "content { editor reference featured { label \"Featured\" assetTypes [RECORD_SET] dataset \"team\" } }",
                "<ul>$CMS_VALUE(featured)$</ul>");
        TemplateView t4 = pageTemplate(fx, "Everyone", "",
                "$CMS_FOR(m : dataset:team, sort=\"name\")$$CMS_VALUE(m.name)$$CMS_END_FOR$");
        TemplateView t5 = pageTemplate(fx, "Plain", "", "<p>plain</p>");
        UUID p1 = page(fx, t1, "P1");
        UUID p2 = page(fx, t2, "P2");
        UUID p3 = featuredPage(fx, t3, "P3", staff.uuid());
        UUID p4 = page(fx, t4, "P4");
        UUID p5 = page(fx, t5, "P5");

        // Edit a lead in leads: the set's query selects her; the dataset loop reads every record.
        long baseline = head(fx);
        jane = update(fx, jane, "{\"name\":\"Jane D.\",\"role\":\"lead\"}");
        BuildPlan plan = plan(fx, baseline);
        assertThat(pages(plan)).containsExactlyInAnyOrder(p1, p4).doesNotContain(p5);
        assertChain(plan.reasonFor(p1), RebuildRootKind.ASSET_RELEASED, "RECORD", jane.uid(),
                step(p1, RebuildEdgeKind.PAGE_TEMPLATE, "templateRef"),
                step(t1.uuid(), RebuildEdgeKind.RECORD_SET_MEMBERSHIP, "leads"));
        assertChain(plan.reasonFor(p4), RebuildRootKind.ASSET_RELEASED, "RECORD", jane.uid(),
                step(p4, RebuildEdgeKind.PAGE_TEMPLATE, "templateRef"),
                step(t4.uuid(), RebuildEdgeKind.DATASET_MEMBERSHIP, "team"));

        // Edit a non-lead in leads: the set's query never selects her, before or after.
        baseline = head(fx);
        eve = update(fx, eve, "{\"name\":\"Eve K.\",\"role\":\"dev\"}");
        plan = plan(fx, baseline);
        assertThat(pages(plan)).containsExactly(p4);

        // Add a record to staff: the loop over staff, the reference editor value rendering staff, the dataset loop.
        baseline = head(fx);
        RecordDetail cy = record(fx, staff.uuid(), "{\"name\":\"Cy\",\"role\":\"dev\"}");
        plan = plan(fx, baseline);
        assertThat(pages(plan)).containsExactlyInAnyOrder(p2, p3, p4);
        assertChain(plan.reasonFor(p2), RebuildRootKind.ASSET_RELEASED, "RECORD", cy.uid(),
                step(p2, RebuildEdgeKind.PAGE_TEMPLATE, "templateRef"),
                step(t2.uuid(), RebuildEdgeKind.RECORD_SET_MEMBERSHIP, "staff"));
        // The page itself reads the set: its reference editor value is a CONTENT_REF row to it.
        assertChain(plan.reasonFor(p3), RebuildRootKind.ASSET_RELEASED, "RECORD", cy.uid(),
                step(p3, RebuildEdgeKind.RECORD_SET_MEMBERSHIP, "staff"));

        // Move a lead from staff to leads: the old set's readers (old version) and the new set's (new version).
        baseline = head(fx);
        assetService.move(ann.uuid(), leads.uuid(), fx.ctx());
        plan = plan(fx, baseline);
        assertThat(pages(plan)).containsExactlyInAnyOrder(p1, p2, p3, p4);
        assertThat(plan.reasonFor(p1).steps()).last().satisfies(last -> assertThat(last.sourcePath()).isEqualTo("leads"));
        assertThat(plan.reasonFor(p2).steps()).last().satisfies(last -> assertThat(last.sourcePath()).isEqualTo("staff"));

        // Moving a non-lead into leads: the new set filters it out, the old set showed it.
        baseline = head(fx);
        assetService.move(cy.uuid(), leads.uuid(), fx.ctx());
        assertThat(pages(plan(fx, baseline))).containsExactlyInAnyOrder(p2, p3, p4);

        // Change the leads query: every reader of leads, and only those.
        baseline = head(fx);
        leads = recordSetService.update(leads.uuid(),
                new UpdateRecordSetCommand(null, new RecordSetQuery("role == 'lead' || name == 'Eve K.'", null, null, null)),
                leads.revision(), fx.ctx());
        plan = plan(fx, baseline);
        assertThat(pages(plan)).containsExactly(p1);
        assertChain(plan.reasonFor(p1), RebuildRootKind.ASSET_RELEASED, "RECORD_SET", "leads",
                step(p1, RebuildEdgeKind.PAGE_TEMPLATE, "templateRef"),
                step(t1.uuid(), RebuildEdgeKind.RECORD_SET_QUERY, "channelTemplates.html"));

        // Rename staff: every reader of staff, over its reference rows.
        baseline = head(fx);
        recordSetService.update(staff.uuid(), new UpdateRecordSetCommand("Our staff", staff.query()), staff.revision(), fx.ctx());
        plan = plan(fx, baseline);
        assertThat(pages(plan)).containsExactlyInAnyOrder(p2, p3);
        assertThat(plan.reasonFor(p3).firstEdge()).isEqualTo(RebuildEdgeKind.REFERENCE);

        // Change the html record template: only the pages rendering a set's records through it.
        baseline = head(fx);
        DatasetView current = datasetService.find(fx.projectId(), team.uuid(), null).orElseThrow();
        datasetService.update(team.uuid(), new UpdateDatasetCommand("Team", CdlSources.split(TEAM_CDL), "name", null,
                Map.of("html", "<li class=\"member\">$CMS_VALUE(name)$</li>")), current.revision(), fx.ctx());
        plan = plan(fx, baseline);
        assertThat(pages(plan)).containsExactlyInAnyOrder(p1, p3);
        assertChain(plan.reasonFor(p1), RebuildRootKind.ASSET_CHANGED, "DATASET", team.uid(),
                step(p1, RebuildEdgeKind.PAGE_TEMPLATE, "templateRef"),
                step(t1.uuid(), RebuildEdgeKind.RECORD_TEMPLATE, "leads"));
        assertChain(plan.reasonFor(p3), RebuildRootKind.ASSET_CHANGED, "DATASET", team.uid(),
                step(p3, RebuildEdgeKind.RECORD_TEMPLATE, "staff"));

        // A record change in the same window as a record template change still reaches its loop readers.
        baseline = head(fx);
        current = datasetService.find(fx.projectId(), team.uuid(), null).orElseThrow();
        datasetService.update(team.uuid(), new UpdateDatasetCommand("Team", CdlSources.split(TEAM_CDL), "name", null,
                Map.of("html", "<li>$CMS_VALUE(name)$</li>")), current.revision(), fx.ctx());
        update(fx, eve, "{\"name\":\"Eve\",\"role\":\"dev\"}");
        assertThat(pages(plan(fx, baseline))).containsExactlyInAnyOrder(p1, p3, p4);

        // A schema change: every reader of the dataset and of all its sets.
        baseline = head(fx);
        current = datasetService.find(fx.projectId(), team.uuid(), null).orElseThrow();
        datasetService.update(team.uuid(), new UpdateDatasetCommand("Team", CdlSources.split(TEAM_CDL.replace("\"Role\"", "\"Team role\"")),
                "name", null), current.revision(), fx.ctx());
        assertThat(pages(plan(fx, baseline))).containsExactlyInAnyOrder(p1, p2, p3, p4).doesNotContain(p5);
    }

    /**
     * Nested set rendering: dataset {@code groups}' record template renders each group's {@code members} reference
     * editor (a set of {@code team}) and loops {@code dataset:team} for its leads; P6 renders {@code recordset:groups},
     * P7 loops {@code recordset:alumni}.
     */
    @Test
    void aSetRenderedThroughARecordsReferenceEditorOrARecordTemplateLoopIsFollowed() {
        Fixture fx = newFixture();
        DatasetView team = datasetService.create(new CreateDatasetCommand(
                fx.projectId(), null, "Team", CdlSources.split(TEAM_CDL), "name", null, Map.of("html", "<i>$CMS_VALUE(name)$</i>")), fx.ctx());
        DatasetView groups = datasetService.create(new CreateDatasetCommand(fx.projectId(), null, "Groups",
                CdlSources.split("content { editor text name { label \"Name\" }"
                        + " editor reference members { label \"Members\" assetTypes [RECORD_SET] dataset \"team\" } }"),
                "name", null,
                Map.of("html", "<h2>$CMS_VALUE(name)$</h2>$CMS_VALUE(members)$"
                        + "|$CMS_FOR(m : dataset:team, where=\"m.role == 'lead'\")$$CMS_VALUE(m.name)$$CMS_END_FOR$")),
                fx.ctx());
        RecordSetView staff = recordSetService.create(new CreateRecordSetCommand(fx.projectId(), null, team.uuid(),
                "staff", "Staff", RecordSetQuery.ALL), fx.ctx());
        RecordSetView alumni = recordSetService.create(new CreateRecordSetCommand(fx.projectId(), null, team.uuid(),
                "alumni", "Alumni", RecordSetQuery.ALL), fx.ctx());
        RecordSetView groupSet = recordSetService.create(new CreateRecordSetCommand(fx.projectId(), null, groups.uuid(),
                "groups", "Groups", RecordSetQuery.ALL), fx.ctx());
        RecordDetail bob = record(fx, staff.uuid(), "{\"name\":\"Bob\",\"role\":\"dev\"}");
        RecordDetail old = record(fx, alumni.uuid(), "{\"name\":\"Old\",\"role\":\"dev\"}");
        RecordDetail boss = record(fx, alumni.uuid(), "{\"name\":\"Boss\",\"role\":\"lead\"}");
        ObjectNode core = mapper.createObjectNode().put("name", "Core");
        core.set("members", setRef(staff.uuid()));
        RecordDetail coreGroup = recordService.create(
                new CreateRecordCommand(fx.projectId(), groupSet.uuid(), core), fx.ctx()).record();

        TemplateView t6 = pageTemplate(fx, "Groups", "", "$CMS_VALUE(recordset:groups)$");
        TemplateView t7 = pageTemplate(fx, "Alumni", "",
                "$CMS_FOR(m : recordset:alumni)$$CMS_VALUE(m.name)$$CMS_END_FOR$");
        UUID p6 = page(fx, t6, "P6");
        UUID p7 = page(fx, t7, "P7");

        // A staff member renders inside the core group's record: bob → staff → core group → groups → P6.
        long baseline = head(fx);
        update(fx, bob, "{\"name\":\"Bob B.\",\"role\":\"dev\"}");
        BuildPlan plan = plan(fx, baseline);
        assertThat(pages(plan)).containsExactly(p6);
        assertChain(plan.reasonFor(p6), RebuildRootKind.ASSET_RELEASED, "RECORD", bob.uid(),
                step(p6, RebuildEdgeKind.PAGE_TEMPLATE, "templateRef"),
                step(t6.uuid(), RebuildEdgeKind.RECORD_SET_MEMBERSHIP, "groups"),
                step(coreGroup.uuid(), RebuildEdgeKind.RECORD_SET_MEMBERSHIP, "staff"));

        // An alumni developer: only the alumni loop — the groups' record template loop selects leads only.
        baseline = head(fx);
        update(fx, old, "{\"name\":\"Old T.\",\"role\":\"dev\"}");
        assertThat(pages(plan(fx, baseline))).containsExactly(p7);

        // An alumni lead: the groups' record template loop selects her, so every group rendering changes.
        baseline = head(fx);
        update(fx, boss, "{\"name\":\"Big Boss\",\"role\":\"lead\"}");
        plan = plan(fx, baseline);
        assertThat(pages(plan)).containsExactlyInAnyOrder(p6, p7);
        assertChain(plan.reasonFor(p6), RebuildRootKind.ASSET_RELEASED, "RECORD", boss.uid(),
                step(p6, RebuildEdgeKind.PAGE_TEMPLATE, "templateRef"),
                step(t6.uuid(), RebuildEdgeKind.RECORD_TEMPLATE, "groups"),
                step(groups.uuid(), RebuildEdgeKind.DATASET_MEMBERSHIP, "team"));

        // Team's record template renders the members inside every group: P6, not the alumni loop.
        baseline = head(fx);
        DatasetView current = datasetService.find(fx.projectId(), team.uuid(), null).orElseThrow();
        datasetService.update(team.uuid(), new UpdateDatasetCommand("Team", CdlSources.split(TEAM_CDL), "name", null,
                Map.of("html", "<b>$CMS_VALUE(name)$</b>")), current.revision(), fx.ctx());
        plan = plan(fx, baseline);
        assertThat(pages(plan)).containsExactly(p6);
        assertChain(plan.reasonFor(p6), RebuildRootKind.ASSET_CHANGED, "DATASET", team.uid(),
                step(p6, RebuildEdgeKind.PAGE_TEMPLATE, "templateRef"),
                step(t6.uuid(), RebuildEdgeKind.RECORD_SET_MEMBERSHIP, "groups"),
                step(coreGroup.uuid(), RebuildEdgeKind.RECORD_TEMPLATE, "staff"));
    }

    // ------------------------------------------------------------------

    private record ExpectedStep(UUID assetUuid, RebuildEdgeKind edge, String sourcePath) {}

    private static ExpectedStep step(UUID assetUuid, RebuildEdgeKind edge, String sourcePath) {
        return new ExpectedStep(assetUuid, edge, sourcePath);
    }

    private static void assertChain(
            RebuildReason reason, RebuildRootKind rootKind, String rootType, String rootUid, ExpectedStep... steps) {
        assertThat(reason.rootKind()).isEqualTo(rootKind);
        assertThat(reason.rootType()).isEqualTo(rootType);
        assertThat(reason.rootUid()).isEqualTo(rootUid);
        List<ExpectedStep> actual = reason.steps().stream()
                .map((RebuildStep s) -> new ExpectedStep(s.assetUuid(), s.edge(), s.sourcePath()))
                .toList();
        assertThat(actual).containsExactly(steps);
    }

    private BuildPlan plan(Fixture fx, long lastSuccessfulRevision) {
        OutputPathResolver paths = mock(OutputPathResolver.class);
        when(paths.resolvePagePath(any(), any())).thenAnswer(call -> call.getArgument(0).toString());
        return buildPlanner.plan(
                releasedSnapshot(fx.projectId()),
                GenerationMode.INCREMENTAL,
                lastSuccessfulRevision,
                Set.of("html"),
                null,
                null,
                paths);
    }

    private static Set<UUID> pages(BuildPlan plan) {
        return plan.entries().stream().map(PlanEntry::pageUuid).collect(Collectors.toSet());
    }

    private long head(Fixture fx) {
        return releasedSnapshot(fx.projectId()).revision();
    }

    private UUID page(Fixture fx, TemplateView template, String name) {
        return pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx()).uuid();
    }

    private UUID featuredPage(Fixture fx, TemplateView template, String name, UUID set) {
        AssetVersionView page = pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx());
        ObjectNode payload = page.payload().deepCopy();
        payload.putObject("content").set("featured", setRef(set));
        return pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx()).uuid();
    }

    private ObjectNode setRef(UUID set) {
        return mapper.createObjectNode().put("type", "ASSET_REF").put("uuid", set.toString()).put("assetType", "RECORD_SET");
    }

    private TemplateView pageTemplate(Fixture fx, String name, String cdl, String html) {
        return templateService.create(
                new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE, name, CdlSources.split(cdl),
                        Map.of("html", html), null, false, Map.of("html", "{displayNameSlug}.{ext}")),
                fx.ctx());
    }

    private RecordDetail record(Fixture fx, UUID set, String content) {
        return recordService.create(new CreateRecordCommand(fx.projectId(), set, json(content)), fx.ctx()).record();
    }

    private RecordDetail update(Fixture fx, RecordDetail record, String content) {
        return recordService.update(record.uuid(), json(content), record.revision(), fx.ctx()).record();
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
                "rsplan-user-" + n, "rsplan-user-" + n + "@example.com", "Record Set Plan User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("rsplanp_" + n, "Record Set Plan Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        long projectId() {
            return project().getId();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }

    /** The released snapshot at head, after releasing everything pending (M27.2.1): what a build started now renders. */
    private Snapshot releasedSnapshot(long projectId) {
        releaseFixtures.releaseAll(projectId);
        return snapshotService.snapshot(projectId, null, SnapshotView.RELEASED);
    }
}
