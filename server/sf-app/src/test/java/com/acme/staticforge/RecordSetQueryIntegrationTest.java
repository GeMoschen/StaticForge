package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.CreateRecordSetCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordDetail;
import com.acme.staticforge.asset.dataset.RecordPage;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordService.RecordListQuery;
import com.acme.staticforge.asset.dataset.RecordSetQueryPreview;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.RecordSetView;
import com.acme.staticforge.asset.dataset.UpdateDatasetCommand;
import com.acme.staticforge.asset.dataset.UpdateRecordSetCommand;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.template.query.RecordSetQueryDiagnostic;
import com.acme.staticforge.template.query.SortKey;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@code M25.1.2}: a record set's stored query — validated on save, rewritten by a dataset schema rename in
 * the schema change's own revision, flagged (never widened) when a field it reads disappears, and applied by
 * the record grid and the query preview through the shared {@code RecordSetQueries} evaluator.
 */
@SpringBootTest
@ActiveProfiles("test")
class RecordSetQueryIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String TEAM_CDL = """
            content {
              editor text name { label "Name" }
              editor text role { label "Role" }
              editor date joined { label "Joined" }
              editor richtext bio { label "Bio" }
            }
            """;

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired RevisionRepository revisionRepository;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void anInvalidQueryIsRejectedWithDiagnosticsAndWritesNothing() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        long before = revisionCount(fx);

        assertThatThrownBy(() -> recordSetService.create(
                        new CreateRecordSetCommand(fx.projectId(), null, team.uuid(), null, "Leads",
                                new RecordSetQuery("role == 'lead' && squad == 'core'", "-bio", -1, null)),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(diagnostics(ex))
                            .extracting(d -> d.path("field").asText(), d -> d.path("code").asText(), d -> d.path("column").asInt())
                            .containsExactly(
                                    org.assertj.core.groups.Tuple.tuple("where", DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD, 19),
                                    org.assertj.core.groups.Tuple.tuple("sort", DiagnosticCodes.OCTL_DATASET_UNSORTABLE_FIELD, 2),
                                    org.assertj.core.groups.Tuple.tuple("limit", DiagnosticCodes.OCTL_DATASET_QUERY, 0));
                });
        assertThatThrownBy(() -> recordSetService.create(
                        new CreateRecordSetCommand(fx.projectId(), null, team.uuid(), null, "Leads",
                                new RecordSetQuery("role == CMS_PAGE.role", null, null, null)),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(diagnostics(ex))
                        .extracting(d -> d.path("code").asText())
                        .containsExactly(DiagnosticCodes.OCTL_DATASET_QUERY));
        assertThat(revisionCount(fx)).isEqualTo(before);
        assertThat(recordSetService.list(fx.projectId(), team.uuid())).isEmpty();

        RecordSetView leads = set(fx, team, "Leads", new RecordSetQuery("role == 'lead'", "-joined", null, null));
        assertThat(leads.queryValid()).isTrue();
        assertThat(leads.queryDiagnostics()).isEmpty();
        long afterCreate = revisionCount(fx);
        assertThatThrownBy(() -> recordSetService.update(
                        leads.uuid(),
                        new UpdateRecordSetCommand("Leads", new RecordSetQuery("rank > 2", null, null, null)),
                        leads.revision(),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
        assertThat(revisionCount(fx)).isEqualTo(afterCreate);
        assertThat(find(fx, leads).query()).isEqualTo(new RecordSetQuery("role == 'lead'", "-joined", null, null));
    }

    @Test
    void aSchemaRenameRewritesSetQueriesInTheSchemaChangesRevision() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordSetView a = set(fx, team, "A", new RecordSetQuery("role == 'lead'", "-joined", null, null));
        // "role" appears in B only as a string: B's query is not about the renamed field.
        RecordSetView b = set(fx, team, "B", new RecordSetQuery("name != 'role'", "name", null, null));
        RecordDetail ada = record(fx, a, "Ada", "lead", "2021-03-01");
        RecordDetail bob = record(fx, b, "Bob", "dev", "2022-01-01");
        long before = revisionCount(fx);

        DatasetView renamed = datasetService.update(
                team.uuid(),
                new UpdateDatasetCommand("Team", TEAM_CDL.replace(
                        "editor text role { label \"Role\" }", "editor text position { label \"Position\" renamedFrom \"role\" }"),
                        null, null),
                team.revision(),
                fx.ctx());

        assertThat(revisionCount(fx)).isEqualTo(before + 1);
        assertThat(touchedAssetUuids(fx, renamed.revision()))
                .as("one revision: the dataset, set A's rewritten query and the rewritten records")
                .containsExactlyInAnyOrder(team.uuid(), a.uuid(), ada.uuid(), bob.uuid());
        RecordSetView rewritten = find(fx, a);
        assertThat(rewritten.query()).isEqualTo(new RecordSetQuery("position == 'lead'", "-joined", null, null));
        assertThat(rewritten.revision()).isEqualTo(renamed.revision());
        assertThat(rewritten.queryValid()).isTrue();
        assertThat(find(fx, b).query()).isEqualTo(new RecordSetQuery("name != 'role'", "name", null, null));
        assertThat(find(fx, b).revision()).isEqualTo(b.revision());
        assertThat(renamed.brokenRecordSets()).isEmpty();

        // The renamed query still selects the record it selected before.
        assertThat(recordSetService.listRecords(fx.projectId(), a.uuid(), all(), true, null, 0, 50).rows())
                .extracting(RecordPage.Row::uuid)
                .containsExactly(ada.uuid());
    }

    @Test
    void removingAFieldASetReadsFlagsTheSetUntilItIsSavedValid() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordSetView a = set(fx, team, "A", new RecordSetQuery("role == 'lead'", "-joined", null, null));
        RecordSetView b = set(fx, team, "B", RecordSetQuery.ALL);
        record(fx, a, "Ada", "lead", "2021-03-01");
        record(fx, a, "Cy", "lead", "2020-03-01");

        DatasetView saved = datasetService.update(
                team.uuid(),
                new UpdateDatasetCommand("Team", TEAM_CDL.replace("editor date joined { label \"Joined\" }", ""), null, null),
                team.revision(),
                fx.ctx());

        assertThat(saved.brokenRecordSets()).singleElement().satisfies(broken -> {
            assertThat(broken.uid()).isEqualTo("a");
            assertThat(broken.uuid()).isEqualTo(a.uuid());
            assertThat(broken.diagnostics()).extracting(RecordSetQueryDiagnostic::field, RecordSetQueryDiagnostic::code)
                    .containsExactly(org.assertj.core.groups.Tuple.tuple("sort", DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD));
        });
        RecordSetView flagged = find(fx, a);
        assertThat(flagged.queryValid()).isFalse();
        assertThat(flagged.queryDiagnostics()).extracting(RecordSetQueryDiagnostic::message)
                .containsExactly("Unknown dataset field in sort: joined");
        assertThat(flagged.query()).as("the stored query is kept as it was").isEqualTo(a.query());
        assertThat(recordSetService.list(fx.projectId(), team.uuid()))
                .extracting(RecordSetView::uid, RecordSetView::queryValid)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("a", false), org.assertj.core.groups.Tuple.tuple("b", true));
        // Time travel checks the query against the schema of that revision.
        assertThat(recordSetService.find(fx.projectId(), a.uuid(), saved.revision() - 1).orElseThrow().queryValid()).isTrue();

        // A broken set shows nothing — never every record — while the unfiltered grid still lists them.
        assertThat(recordSetService.listRecords(fx.projectId(), a.uuid(), all(), true, null, 0, 50).totalElements()).isZero();
        assertThat(recordSetService.listRecords(fx.projectId(), a.uuid(), all(), false, null, 0, 50).totalElements()).isEqualTo(2);
        assertThat(recordSetService.previewQuery(fx.projectId(), a.uuid(), flagged.query()).valid()).isFalse();

        RecordSetView fixed = recordSetService.update(
                a.uuid(), new UpdateRecordSetCommand("A", new RecordSetQuery("role == 'lead'", "name", null, null)),
                flagged.revision(), fx.ctx());
        assertThat(fixed.queryValid()).isTrue();
        assertThat(find(fx, a).queryValid()).isTrue();
        assertThat(recordSetService.listRecords(fx.projectId(), a.uuid(), all(), true, null, 0, 50).totalElements()).isEqualTo(2);
        assertThat(find(fx, b).queryValid()).isTrue();
    }

    @Test
    void theGridAppliesTheSetQueryFirstAndTheRequestNarrowsIt() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordSetView leads = set(fx, team, "Leads", new RecordSetQuery("role == 'lead'", "-joined", 3, null));
        RecordDetail ann = record(fx, leads, "Ann", "lead", "2021-03-01");
        record(fx, leads, "Bob", "dev", "2022-01-01");
        RecordDetail cyd = record(fx, leads, "Cyd", "lead", "2019-06-01");
        RecordDetail dan = record(fx, leads, "Dan", "lead", "2024-02-01");
        RecordDetail eve = record(fx, leads, "Eve", "lead", "2018-01-01");

        // The set query alone: leads by -joined, the first three.
        assertThat(uuids(recordSetService.listRecords(fx.projectId(), leads.uuid(), all(), true, null, 0, 50)))
                .containsExactly(dan.uuid(), ann.uuid(), cyd.uuid());
        // Request where is AND-ed and keeps the set's order; request sort re-sorts; q filters names.
        assertThat(uuids(recordSetService.listRecords(fx.projectId(), leads.uuid(),
                        new RecordListQuery(null, null, "joined < '2022-01-01'", List.of()), true, null, 0, 50)))
                .containsExactly(ann.uuid(), cyd.uuid());
        assertThat(uuids(recordSetService.listRecords(fx.projectId(), leads.uuid(),
                        new RecordListQuery(null, null, null, List.of(SortKey.asc("name"))), true, null, 0, 50)))
                .containsExactly(ann.uuid(), cyd.uuid(), dan.uuid());
        assertThat(uuids(recordSetService.listRecords(fx.projectId(), leads.uuid(),
                        new RecordListQuery("y", null, null, List.of()), true, null, 0, 50)))
                .as("q never pulls Eve into the set's three")
                .containsExactly(cyd.uuid());
        // Without the set query: every record of the set, default order, paged.
        RecordPage page = recordSetService.listRecords(fx.projectId(), leads.uuid(), all(), false, null, 1, 2);
        assertThat(page.totalElements()).isEqualTo(5);
        assertThat(uuids(page)).containsExactly(cyd.uuid(), dan.uuid());
        assertThat(page.rows().get(0).values().path("role").asText()).isEqualTo("lead");
        assertThat(uuids(recordSetService.listRecords(fx.projectId(), leads.uuid(),
                        new RecordListQuery(null, null, "joined < '2019-01-01'", List.of()), false, null, 0, 50)))
                .containsExactly(eve.uuid());
        // The request is checked like the dataset listing's.
        assertThatThrownBy(() -> recordSetService.listRecords(fx.projectId(), leads.uuid(),
                        new RecordListQuery(null, null, "squad == 1", List.of()), true, null, 0, 50))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(400));
    }

    @Test
    void aDraftQueryIsPreviewedWithoutSaving() {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordSetView staff = set(fx, team, "Staff", RecordSetQuery.ALL);
        record(fx, staff, "Ann", "lead", "2021-03-01");
        record(fx, staff, "Bob", "dev", "2022-01-01");
        record(fx, staff, "Cyd", "lead", "2019-06-01");
        long before = revisionCount(fx);

        RecordSetQueryPreview preview = recordSetService.previewQuery(
                fx.projectId(), staff.uuid(), new RecordSetQuery("role == 'lead'", "-joined", 1, null));
        RecordSetQueryPreview invalid = recordSetService.previewQuery(
                fx.projectId(), staff.uuid(), new RecordSetQuery("role == ", null, null, null));

        assertThat(preview.valid()).isTrue();
        assertThat(preview.diagnostics()).isEmpty();
        assertThat(preview.matchCount()).isEqualTo(2);
        assertThat(preview.selectedCount()).isEqualTo(1);
        assertThat(invalid.valid()).isFalse();
        assertThat(invalid.diagnostics()).extracting(RecordSetQueryDiagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_DATASET_QUERY);
        assertThat(revisionCount(fx)).isEqualTo(before);
        assertThat(find(fx, staff).query()).isEqualTo(RecordSetQuery.ALL);
    }

    // ------------------------------------------------------------------

    private static RecordListQuery all() {
        return new RecordListQuery(null, null, null, List.of());
    }

    private static List<UUID> uuids(RecordPage page) {
        return page.rows().stream().map(RecordPage.Row::uuid).toList();
    }

    private List<JsonNode> diagnostics(SfException ex) {
        List<JsonNode> out = new ArrayList<>();
        mapper.valueToTree(ex.getProblem().getExtensions().get("diagnostics")).forEach(out::add);
        return out;
    }

    private DatasetView team(Fixture fx) {
        return datasetService.create(new CreateDatasetCommand(fx.projectId(), null, "Team", TEAM_CDL, "name", null), fx.ctx());
    }

    private RecordSetView set(Fixture fx, DatasetView dataset, String name, RecordSetQuery query) {
        return recordSetService.create(
                new CreateRecordSetCommand(fx.projectId(), null, dataset.uuid(), null, name, query), fx.ctx());
    }

    private RecordDetail record(Fixture fx, RecordSetView set, String name, String role, String joined) {
        return recordService.create(
                        new CreateRecordCommand(fx.projectId(), set.uuid(), name,
                                mapper.createObjectNode().put("name", name).put("role", role).put("joined", joined)),
                        fx.ctx())
                .record();
    }

    private RecordSetView find(Fixture fx, RecordSetView set) {
        return recordSetService.find(fx.projectId(), set.uuid(), null).orElseThrow();
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.projectId()).size();
    }

    private List<UUID> touchedAssetUuids(Fixture fx, long revisionId) {
        Revision revision = revisionRepository.findByProjectIdAndRevisionId(fx.projectId(), revisionId).orElseThrow();
        List<UUID> uuids = new ArrayList<>();
        revision.getSummary().path("assets").forEach(entry -> {
            if (!"PROJECT".equals(entry.path("type").asText())) {
                uuids.add(UUID.fromString(entry.path("uuid").asText()));
            }
        });
        return uuids;
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "setquery-user-" + n, "setquery-user-" + n + "@example.com", "Set Query User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("setqueryp_" + n, "Set Query Project " + n, null, null), user.getId());
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
}
