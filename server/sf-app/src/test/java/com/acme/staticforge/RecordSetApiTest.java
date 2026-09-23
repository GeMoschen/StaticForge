package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.CreateRecordSetCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.RecordSetView;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * {@link com.acme.staticforge.api.RecordSetController} over HTTP (M25.3.1): the {@code EDITOR}/{@code VIEWER}
 * split, the {@code ETag}/{@code If-Match} protocol, time travel, {@code 422} query diagnostics, the
 * {@code 409} non-cascading delete, the set grid with and without the stored query, the query preview, record
 * creation by set, and the generic asset endpoints ({@code AssetController}) accepting {@code RECORD_SET}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RecordSetApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String TEAM_CDL =
            """
            content {
              editor text name { label "Name" required }
              editor text role { label "Role" }
              editor date joined { label "Joined" }
              editor richtext bio { label "Bio" }
            }
            """;

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired RevisionRepository revisionRepository;

    @Test
    void editorsWriteSetsViewersReadThem() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        JsonNode folder = json(send(fx, fx.editorToken(), post(project(fx) + "/folders"),
                "{\"displayName\":\"People\",\"scope\":\"CONTENT\"}"));
        ObjectNode body = objectMapper.createObjectNode()
                .put("folderUuid", folder.get("uuid").asText())
                .put("datasetUuid", team.uuid().toString())
                .put("displayName", "Leadership")
                .put("uid", "leadership");
        body.putObject("query").put("where", "role == 'lead'").put("sort", "-joined").put("limit", 10);

        send(fx, fx.viewerToken(), post(sets(fx)), body.toString()).andExpect(status().isForbidden());
        send(fx, fx.developerToken(), post(sets(fx)), body.toString()).andExpect(status().isCreated());
        JsonNode created = json(send(fx, fx.editorToken(), post(sets(fx)), body.put("uid", "leads").toString())
                .andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.ETAG, org.hamcrest.Matchers.matchesPattern("\"rev-\\d+\"")))
                .andExpect(jsonPath("$.uid").value("leads"))
                .andExpect(jsonPath("$.dataset.uuid").value(team.uuid().toString()))
                .andExpect(jsonPath("$.dataset.uid").value("team"))
                .andExpect(jsonPath("$.dataset.displayName").value("Team"))
                .andExpect(jsonPath("$.folderUuid").value(folder.get("uuid").asText()))
                .andExpect(jsonPath("$.folderPath").value("/people/"))
                .andExpect(jsonPath("$.query.where").value("role == 'lead'"))
                .andExpect(jsonPath("$.query.sort").value("-joined"))
                .andExpect(jsonPath("$.query.limit").value(10))
                .andExpect(jsonPath("$.queryValid").value(true))
                .andExpect(jsonPath("$.queryDiagnostics").isEmpty())
                .andExpect(jsonPath("$.recordCount").value(0)));
        String uuid = created.get("uuid").asText();
        record(fx, UUID.fromString(uuid), "Ada", "lead", "2021-03-01");

        send(fx, fx.editorToken(), post(sets(fx)), "{\"displayName\":\"No dataset\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("datasetUuid"));

        send(fx, fx.viewerToken(), get(sets(fx)).param("dataset", team.uuid().toString()), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].uid").value("leadership"))
                .andExpect(jsonPath("$[1].uid").value("leads"))
                .andExpect(jsonPath("$[1].dataset.uid").value("team"))
                .andExpect(jsonPath("$[1].folderPath").value("/people/"))
                .andExpect(jsonPath("$[1].recordCount").value(1))
                .andExpect(jsonPath("$[1].queryValid").value(true));
        send(fx, fx.viewerToken(), get(sets(fx) + "/" + uuid), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recordCount").value(1));
        send(fx, fx.viewerToken(), get(sets(fx) + "/" + uuid + "/records"), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].displayName").value("Ada"));

        long revision = created.get("revision").asLong();
        String rename = "{\"displayName\":\"Leads\",\"query\":{\"where\":\"role == 'lead'\"}}";
        send(fx, fx.viewerToken(), withIfMatch(put(sets(fx) + "/" + uuid), revision), rename)
                .andExpect(status().isForbidden());
        send(fx, fx.viewerToken(), post(sets(fx) + "/" + uuid + "/preview-query"), "{}")
                .andExpect(status().isForbidden());
        send(fx, fx.viewerToken(), delete(sets(fx) + "/" + uuid).param("cascade", "true"), null)
                .andExpect(status().isForbidden());
        send(fx, fx.editorToken(), withIfMatch(put(sets(fx) + "/" + uuid), revision), rename)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Leads"))
                .andExpect(jsonPath("$.query.sort").doesNotExist());
    }

    @Test
    void ifMatchConflictsAndTimeTravel() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordSetView set = set(fx, team, "Leads", new RecordSetQuery("role == 'lead'", null, null, null));
        String url = sets(fx) + "/" + set.uuid();

        send(fx, fx.editorToken(), put(url), "{\"displayName\":\"No precondition\"}")
                .andExpect(status().isPreconditionFailed());
        JsonNode updated = json(send(fx, fx.editorToken(), withIfMatch(put(url), set.revision()),
                        "{\"displayName\":\"Leadership\",\"query\":{\"where\":\"role != 'lead'\",\"offset\":1}}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.query.offset").value(1)));
        assertThat(updated.get("revision").asLong()).isGreaterThan(set.revision());
        send(fx, fx.editorToken(), withIfMatch(put(url), set.revision()), "{\"displayName\":\"Stale\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-API-0409"));

        send(fx, fx.viewerToken(), get(url), null)
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"rev-" + updated.get("revision").asLong() + "\""))
                .andExpect(jsonPath("$.displayName").value("Leadership"));
        send(fx, fx.viewerToken(), get(url).param("revision", String.valueOf(set.revision())), null)
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"rev-" + set.revision() + "\""))
                .andExpect(jsonPath("$.displayName").value("Leads"))
                .andExpect(jsonPath("$.query.where").value("role == 'lead'"))
                .andExpect(jsonPath("$.query.offset").doesNotExist());
        send(fx, fx.viewerToken(), get(url).param("revision", String.valueOf(set.revision() - 1)), null)
                .andExpect(status().isNotFound());
    }

    @Test
    void anInvalidQueryIs422WithDiagnosticsAndThePreviewReportsIt() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        long before = revisionCount(fx);
        ObjectNode body = objectMapper.createObjectNode()
                .put("datasetUuid", team.uuid().toString())
                .put("displayName", "Broken");
        body.putObject("query").put("where", "role == 'lead' && squad == 'core'").put("sort", "-bio");

        send(fx, fx.editorToken(), post(sets(fx)), body.toString())
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-API-0422"))
                .andExpect(jsonPath("$.diagnostics[0].field").value("where"))
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD))
                .andExpect(jsonPath("$.diagnostics[0].column").value(19))
                .andExpect(jsonPath("$.diagnostics[1].field").value("sort"))
                .andExpect(jsonPath("$.diagnostics[1].code").value(DiagnosticCodes.OCTL_DATASET_UNSORTABLE_FIELD));
        assertThat(revisionCount(fx)).isEqualTo(before);

        RecordSetView set = set(fx, team, "Team", RecordSetQuery.ALL);
        record(fx, set.uuid(), "Ada", "lead", "2021-03-01");
        record(fx, set.uuid(), "Bob", "dev", "2022-01-01");
        record(fx, set.uuid(), "Dee", "lead", "2019-05-05");
        long afterSeed = revisionCount(fx);

        send(fx, fx.editorToken(), withIfMatch(put(sets(fx) + "/" + set.uuid()), set.revision()),
                        "{\"displayName\":\"Team\",\"query\":{\"where\":\"CMS_PAGE.role == 'lead'\"}}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.OCTL_DATASET_QUERY));
        assertThat(revisionCount(fx)).isEqualTo(afterSeed);

        send(fx, fx.editorToken(), post(sets(fx) + "/" + set.uuid() + "/preview-query"),
                        "{\"where\":\"role == 'lead'\",\"limit\":1}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true))
                .andExpect(jsonPath("$.diagnostics").isEmpty())
                .andExpect(jsonPath("$.matchCount").value(2))
                .andExpect(jsonPath("$.selectedCount").value(1));
        send(fx, fx.editorToken(), post(sets(fx) + "/" + set.uuid() + "/preview-query"), "{\"sort\":\"rank\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.diagnostics[0].field").value("sort"))
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD))
                .andExpect(jsonPath("$.matchCount").value(0));
        assertThat(revisionCount(fx)).as("a preview writes nothing").isEqualTo(afterSeed);
    }

    @Test
    void theSetGridAppliesTheStoredQueryAndTheRequestNarrowsIt() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordSetView leads = set(fx, team, "Leads", new RecordSetQuery("role == 'lead'", "-joined", null, null));
        record(fx, leads.uuid(), "Ada", "lead", "2021-03-01");
        record(fx, leads.uuid(), "Bob", "dev", "2022-01-01");
        record(fx, leads.uuid(), "Dee", "lead", "2019-05-05");
        record(fx, leads.uuid(), "Eve", "lead", "2023-07-15");
        RecordSetView other = set(fx, team, "Others", RecordSetQuery.ALL);
        record(fx, other.uuid(), "Zed", "lead", "2024-01-01");
        String records = sets(fx) + "/" + leads.uuid() + "/records";

        assertThat(names(send(fx, fx.viewerToken(), get(records).param("applySetQuery", "true"), null)))
                .as("the stored query: leads, newest first")
                .containsExactly("Eve", "Ada", "Dee");
        assertThat(names(send(fx, fx.viewerToken(),
                        get(records).param("applySetQuery", "true").param("where", "joined > '2020-01-01'"), null)))
                .as("request where is AND-ed, the set's order kept")
                .containsExactly("Eve", "Ada");
        assertThat(names(send(fx, fx.viewerToken(), get(records)
                        .param("applySetQuery", "true")
                        .param("where", "joined > '2020-01-01'")
                        .param("sort", "_displayName,asc"), null)))
                .as("request sort re-sorts the intersection")
                .containsExactly("Ada", "Eve");
        send(fx, fx.viewerToken(), get(records).param("applySetQuery", "true").param("size", "2"), null)
                .andExpect(jsonPath("$.page.totalElements").value(3))
                .andExpect(jsonPath("$.page.totalPages").value(2));

        assertThat(names(send(fx, fx.viewerToken(), get(records), null)))
                .as("without applySetQuery the grid sees every record of the set")
                .containsExactly("Ada", "Bob", "Dee", "Eve");
        assertThat(names(send(fx, fx.viewerToken(), get(records).param("where", "role == 'dev'"), null)))
                .containsExactly("Bob");
        assertThat(names(send(fx, fx.viewerToken(), get(records).param("sort", "joined,desc").param("q", "e"), null)))
                .containsExactly("Eve", "Dee");

        // One parser: the dataset listing's where/sort errors, byte for byte.
        send(fx, fx.viewerToken(), get(records).param("where", "role == 'lead' )"), null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.column").value(16));
        send(fx, fx.viewerToken(), get(records).param("sort", "joined,sideways"), null)
                .andExpect(status().isBadRequest());
        send(fx, fx.viewerToken(), get(records).param("sort", "bio"), null).andExpect(status().isBadRequest());

        // The dataset listing still spans every set of the dataset, set queries not applied.
        send(fx, fx.viewerToken(), get(project(fx) + "/datasets/" + team.uuid() + "/records"), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.totalElements").value(5));
    }

    @Test
    void deletingANonEmptySetNeedsCascadeAndRestoreBringsTheRecordsBack() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordSetView set = set(fx, team, "Leads", RecordSetQuery.ALL);
        record(fx, set.uuid(), "Ada", "lead", "2021-03-01");
        record(fx, set.uuid(), "Bob", "dev", "2022-01-01");
        String url = sets(fx) + "/" + set.uuid();
        long lastLive = json(send(fx, fx.viewerToken(), get(url), null)).get("revision").asLong();

        send(fx, fx.editorToken(), delete(url), null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0110"))
                .andExpect(jsonPath("$.recordCount").value(2));
        send(fx, fx.editorToken(), delete(project(fx) + "/assets/" + set.uuid()), null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0110"));
        send(fx, fx.editorToken(), delete(url).param("cascade", "true"), null).andExpect(status().isNoContent());

        send(fx, fx.viewerToken(), get(url), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(true));
        send(fx, fx.viewerToken(), get(sets(fx)), null).andExpect(jsonPath("$.length()").value(0));
        send(fx, fx.viewerToken(), get(project(fx) + "/datasets/" + team.uuid() + "/records"), null)
                .andExpect(jsonPath("$.page.totalElements").value(0));

        send(fx, fx.editorToken(), post(project(fx) + "/assets/" + set.uuid() + "/restore"),
                        "{\"fromRevision\":" + lastLive + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("RECORD_SET"));
        send(fx, fx.viewerToken(), get(url), null)
                .andExpect(jsonPath("$.deleted").value(false))
                .andExpect(jsonPath("$.recordCount").value(2));
    }

    @Test
    void recordsAreCreatedInASetAndTheOldRequestShapeIsA400() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        RecordSetView set = set(fx, team, "Leads", RecordSetQuery.ALL);
        JsonNode folder = json(send(fx, fx.editorToken(), post(project(fx) + "/folders"),
                "{\"displayName\":\"People\",\"scope\":\"CONTENT\"}"));
        String records = project(fx) + "/datasets/" + team.uuid() + "/records";

        send(fx, fx.editorToken(), post(records),
                        "{\"folderUuid\":\"" + folder.get("uuid").asText() + "\",\"displayName\":\"Ada\",\"content\":{\"name\":\"Ada\"}}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SF-API-0400"))
                .andExpect(jsonPath("$.field").value("recordSetUuid"));

        JsonNode created = json(send(fx, fx.editorToken(), post(records),
                        "{\"recordSetUuid\":\"" + set.uuid() + "\",\"displayName\":\"Ada\",\"content\":{\"name\":\"Ada\"}}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.recordSet.uuid").value(set.uuid().toString()))
                .andExpect(jsonPath("$.recordSet.uid").value("leads"))
                .andExpect(jsonPath("$.recordSet.displayName").value("Leads"))
                .andExpect(jsonPath("$.folderPath").value("/")));
        send(fx, fx.viewerToken(), get(project(fx) + "/records/" + created.get("uuid").asText()), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recordSet.uid").value("leads"));
    }

    @Test
    void genericAssetEndpointsAcceptRecordSetsAndEnforceContainment() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        DatasetView other = datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Other", TEAM_CDL, null, null), fx.ctx());
        RecordSetView leads = set(fx, team, "Leads", RecordSetQuery.ALL);
        RecordSetView staff = set(fx, team, "Staff", RecordSetQuery.ALL);
        RecordSetView foreign = set(fx, other, "Foreign", RecordSetQuery.ALL);
        UUID ada = record(fx, leads.uuid(), "Ada", "lead", "2021-03-01");
        JsonNode folder = json(send(fx, fx.editorToken(), post(project(fx) + "/folders"),
                "{\"displayName\":\"People\",\"scope\":\"CONTENT\"}"));
        String folderUuid = folder.get("uuid").asText();
        String assets = project(fx) + "/assets/";

        // A set moves between Content folders; its records follow its path.
        send(fx, fx.editorToken(), post(assets + leads.uuid() + "/move"), "{\"folderUuid\":\"" + folderUuid + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("RECORD_SET"))
                .andExpect(jsonPath("$.folderPath").value(org.hamcrest.Matchers.endsWith("/people/")));
        send(fx, fx.viewerToken(), get(project(fx) + "/records/" + ada), null)
                .andExpect(jsonPath("$.folderPath").value("/people/"));

        // Containment violations: the FolderScope violation shape with SF-DOM-0104.
        send(fx, fx.editorToken(), post(assets + staff.uuid() + "/move"), "{\"folderUuid\":\"" + leads.uuid() + "\"}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0104"));
        send(fx, fx.editorToken(), post(assets + ada + "/move"), "{\"folderUuid\":\"" + folderUuid + "\"}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0104"));
        send(fx, fx.editorToken(), post(assets + ada + "/move"), "{\"folderUuid\":\"" + foreign.uuid() + "\"}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0104"));
        send(fx, fx.editorToken(), post(assets + ada + "/move"), "{\"folderUuid\":\"" + staff.uuid() + "\"}")
                .andExpect(status().isOk());

        // Display name, uid change, history and usages are generic.
        long current = json(send(fx, fx.viewerToken(), get(sets(fx) + "/" + staff.uuid()), null)).get("revision").asLong();
        send(fx, fx.editorToken(), withIfMatch(patch(assets + staff.uuid() + "/display-name"), current),
                        "{\"displayName\":\"All staff\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("All staff"));
        send(fx, fx.developerToken(), patch(assets + staff.uuid() + "/uid"), "{\"uid\":\"all_staff\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newUid").value("all_staff"));
        send(fx, fx.viewerToken(), get(sets(fx) + "/" + staff.uuid()), null)
                .andExpect(jsonPath("$.uid").value("all_staff"))
                .andExpect(jsonPath("$.displayName").value("All staff"))
                .andExpect(jsonPath("$.recordCount").value(1));
        send(fx, fx.viewerToken(), get(assets + staff.uuid() + "/history"), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(org.hamcrest.Matchers.greaterThanOrEqualTo(2)));
        // Nothing references the set yet (its dataset link is a TEMPLATE edge, not a usage of the dataset).
        send(fx, fx.viewerToken(), get(assets + staff.uuid() + "/usages"), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
        send(fx, fx.viewerToken(), get(assets + staff.uuid() + "/usages").param("revision", String.valueOf(current)), null)
                .andExpect(status().isOk());
    }

    @Test
    void anotherProjectsSetIsNotFound() throws Exception {
        Fixture fx = newFixture();
        Fixture other = newFixture();
        RecordSetView foreign = set(other, team(other), "Foreign", RecordSetQuery.ALL);
        String url = sets(fx) + "/" + foreign.uuid();

        send(fx, fx.viewerToken(), get(url), null).andExpect(status().isNotFound());
        send(fx, fx.viewerToken(), get(url + "/records"), null).andExpect(status().isNotFound());
        send(fx, fx.editorToken(), withIfMatch(put(url), foreign.revision()), "{\"displayName\":\"Leak\"}")
                .andExpect(status().isNotFound());
        send(fx, fx.editorToken(), delete(url).param("cascade", "true"), null).andExpect(status().isNotFound());
        send(fx, fx.editorToken(), post(url + "/preview-query"), "{}").andExpect(status().isNotFound());
        send(fx, fx.viewerToken(), get(sets(other)), null).andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------

    private ResultActions send(Fixture fx, String token, MockHttpServletRequestBuilder request, String body)
            throws Exception {
        request.header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
        if (body != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mvc.perform(request);
    }

    private static MockHttpServletRequestBuilder withIfMatch(MockHttpServletRequestBuilder request, long revision) {
        return request.header(HttpHeaders.IF_MATCH, "\"rev-" + revision + "\"");
    }

    private List<String> names(ResultActions actions) throws Exception {
        JsonNode page = json(actions.andExpect(status().isOk()));
        List<String> names = new ArrayList<>();
        page.get("content").forEach(row -> names.add(row.get("displayName").asText()));
        return names;
    }

    private DatasetView team(Fixture fx) {
        return datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Team", TEAM_CDL, null, null), fx.ctx());
    }

    private RecordSetView set(Fixture fx, DatasetView dataset, String name, RecordSetQuery query) {
        return recordSetService.create(
                new CreateRecordSetCommand(fx.project().getId(), null, dataset.uuid(), null, name, query), fx.ctx());
    }

    private UUID record(Fixture fx, UUID set, String name, String role, String joined) {
        ObjectNode content = objectMapper.createObjectNode().put("name", name).put("role", role).put("joined", joined);
        return recordService.create(new CreateRecordCommand(fx.project().getId(), set, name, content), fx.ctx())
                .record()
                .uuid();
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).size();
    }

    private static String project(Fixture fx) {
        return "/api/v1/projects/" + fx.project().getKey();
    }

    private static String sets(Fixture fx) {
        return project(fx) + "/record-sets";
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(
                "recordsetapi-admin-" + n, "recordsetapi-admin-" + n + "@example.com", "Record Set Api Admin " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("recordsetapip_" + n, "Record Set Api Project " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");
        return new Fixture(
                project,
                admin,
                member(project, "dev", n, ProjectRole.DEVELOPER, ctx),
                member(project, "editor", n, ProjectRole.EDITOR, ctx),
                member(project, "viewer", n, ProjectRole.VIEWER, ctx));
    }

    private AppUser member(Project project, String role, int n, ProjectRole projectRole, RevisionContext ctx) {
        AppUser user = userService.create(
                "recordsetapi-" + role + "-" + n, "recordsetapi-" + role + "-" + n + "@example.com",
                "Record Set Api " + role + " " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), user.getId(), projectRole, ctx);
        return user;
    }

    private final class Fixture {
        private final Project project;
        private final AppUser admin;
        private final AppUser developer;
        private final AppUser editor;
        private final AppUser viewer;

        Fixture(Project project, AppUser admin, AppUser developer, AppUser editor, AppUser viewer) {
            this.project = project;
            this.admin = admin;
            this.developer = developer;
            this.editor = editor;
            this.viewer = viewer;
        }

        Project project() {
            return project;
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "test");
        }

        String developerToken() {
            return jwtService.issueAccessToken(developer);
        }

        String editorToken() {
            return jwtService.issueAccessToken(editor);
        }

        String viewerToken() {
            return jwtService.issueAccessToken(viewer);
        }
    }
}
