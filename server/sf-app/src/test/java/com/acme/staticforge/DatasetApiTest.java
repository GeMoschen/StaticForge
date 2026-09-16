package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@link com.acme.staticforge.api.DatasetController} and {@link com.acme.staticforge.api.RecordController}
 * over HTTP (M19.2.1): the schema/record role split, §8.4's 404-not-403 rule, the {@code If-Match}
 * protocol and the paged, sorted, filtered record listing.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DatasetApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String TEAM_CDL =
            """
            content {
              editor text name { label "Name" required }
              editor text role { label "Role" }
              editor number level { label "Level" }
              editor date joined { label "Joined" }
              editor list tags { label "Tags" item { editor text tag { label "Tag" } } }
            }
            """;

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RevisionService revisionService;
    @Autowired TransactionTemplate transactionTemplate;

    @Test
    void developersOwnSchemasEditorsOwnRecordsViewersRead() throws Exception {
        Fixture fx = newFixture();

        JsonNode dataset = json(mvc.perform(post(datasets(fx))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(datasetBody("Team", TEAM_CDL, "name")))
                .andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.ETAG, org.hamcrest.Matchers.matchesPattern("\"rev-\\d+\"")))
                .andExpect(jsonPath("$.uid").value("team"))
                .andExpect(jsonPath("$.folderPath").value("/templates_root/datasets/"))
                .andExpect(jsonPath("$.titleEditor").value("name"))
                .andExpect(jsonPath("$.recordCount").value(0)));
        String datasetUuid = dataset.get("uuid").asText();

        mvc.perform(post(datasets(fx))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editorToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(datasetBody("Nope", TEAM_CDL, null)))
                .andExpect(status().isForbidden());
        mvc.perform(put(datasets(fx) + "/" + datasetUuid)
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editorToken()))
                        .header(HttpHeaders.IF_MATCH, "\"rev-" + dataset.get("revision").asLong() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(datasetBody("Team", TEAM_CDL, null)))
                .andExpect(status().isForbidden());

        JsonNode record = json(postRecord(fx, fx.editorToken(), datasetUuid, "{\"name\":\"Ada\",\"level\":3}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.displayName").value("Ada"))
                .andExpect(jsonPath("$.datasetUid").value("team"))
                .andExpect(jsonPath("$.folderPath").value("/")));
        postRecord(fx, fx.viewerToken(), datasetUuid, "{\"name\":\"Bob\"}").andExpect(status().isForbidden());

        String recordUuid = record.get("uuid").asText();
        mvc.perform(get(project(fx) + "/records/" + recordUuid).header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"rev-" + record.get("revision").asLong() + "\""))
                .andExpect(jsonPath("$.content.level").value(3));
        putRecord(fx, fx.viewerToken(), recordUuid, record.get("revision").asLong(), "{\"name\":\"Ada\"}")
                .andExpect(status().isForbidden());
        JsonNode updated = json(putRecord(fx, fx.editorToken(), recordUuid, record.get("revision").asLong(), "{\"level\":4}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issues[0].path").value("content.name"))
                .andExpect(jsonPath("$.issues[0].code").value("required")));
        assertThat(updated.get("displayName").asText()).as("no title value: the name is kept").isEqualTo("Ada");

        mvc.perform(get(datasets(fx)).header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].recordCount").value(1));
        mvc.perform(delete(datasets(fx) + "/" + datasetUuid).header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0121"))
                .andExpect(jsonPath("$.recordCount").value(1));
    }

    @Test
    void schemaErrorsAre422WithDiagnosticsAndTheValidateEndpointAgrees() throws Exception {
        Fixture fx = newFixture();
        String bodies = "content { editor text name { label \"Name\" } }\nbodies { body main { label \"Main\" allow [\"*\"] } }";

        mvc.perform(post(datasets(fx))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(datasetBody("Bodies", bodies, null)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.CDL_NOT_ALLOWED_IN_DATASET));
        mvc.perform(post(project(fx) + "/cdl/validate?kind=DATASET")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(objectMapper.createObjectNode().put("source", bodies))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.CDL_NOT_ALLOWED_IN_DATASET));
    }

    @Test
    void anotherProjectsDatasetOrRecordIsNotFound() throws Exception {
        Fixture fx = newFixture();
        Fixture other = newFixture();
        DatasetView foreign = team(other);
        UUID foreignRecord = recordService.create(
                        new CreateRecordCommand(other.project().getId(), foreign.uuid(), null, "Ada", objectMapper.readTree("{\"name\":\"Ada\"}")),
                        other.ctx())
                .record()
                .uuid();

        mvc.perform(get(datasets(fx) + "/" + foreign.uuid()).header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isNotFound());
        mvc.perform(get(datasets(fx) + "/" + foreign.uuid() + "/records").header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isNotFound());
        mvc.perform(get(project(fx) + "/records/" + foreignRecord).header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isNotFound());
        putRecord(fx, fx.editorToken(), foreignRecord.toString(), 1, "{\"name\":\"Leak\"}").andExpect(status().isNotFound());
        postRecord(fx, fx.editorToken(), foreign.uuid().toString(), "{\"name\":\"Leak\"}").andExpect(status().isNotFound());

        // §8.4: without membership a project is not found, exactly like an unknown project key;
        // 403 is reserved for a member whose role is too low (covered above).
        mvc.perform(get(datasets(other)).header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/projects/no_such_project_" + SEQ.get() + "/datasets")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isNotFound());
    }

    @Test
    void ifMatchIsRequiredAndAStaleOneConflicts() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        JsonNode record = json(postRecord(fx, fx.editorToken(), team.uuid().toString(), "{\"name\":\"Ada\"}"));
        long revision = record.get("revision").asLong();
        putRecord(fx, fx.editorToken(), record.get("uuid").asText(), revision, "{\"name\":\"Ada L.\"}").andExpect(status().isOk());

        mvc.perform(put(project(fx) + "/records/" + record.get("uuid").asText())
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editorToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":{\"name\":\"x\"}}"))
                .andExpect(status().isPreconditionFailed());
        putRecord(fx, fx.editorToken(), record.get("uuid").asText(), revision, "{\"name\":\"Stale\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-API-0409"))
                .andExpect(jsonPath("$.currentRevision").isNumber());
        mvc.perform(put(datasets(fx) + "/" + team.uuid())
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken()))
                        .header(HttpHeaders.IF_MATCH, "\"rev-" + (team.revision() - 1) + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(datasetBody("Team", TEAM_CDL, null)))
                .andExpect(status().isConflict());
    }

    @Test
    void recordListingPagesSortsAndFiltersOnTheServer() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        record(fx, team, "{\"name\":\"Ada\",\"role\":\"lead\",\"level\":3,\"joined\":\"2021-03-01\",\"tags\":[{\"tag\":\"x\"}]}");
        record(fx, team, "{\"name\":\"Bob\",\"role\":\"dev\",\"level\":1,\"joined\":\"2023-07-15\"}");
        record(fx, team, "{\"name\":\"Cy\",\"role\":\"dev\",\"level\":2,\"joined\":\"2022-11-30\"}");
        record(fx, team, "{\"name\":\"Dee\",\"role\":\"lead\",\"level\":2,\"joined\":\"2019-05-05\"}");
        String records = datasets(fx) + "/" + team.uuid() + "/records";

        mvc.perform(get(records + "?size=2&page=1&sort=role,desc&sort=_displayName,asc")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].displayName").value("Bob"))
                .andExpect(jsonPath("$.content[1].displayName").value("Cy"))
                .andExpect(jsonPath("$.content[0].values.level").value(1))
                .andExpect(jsonPath("$.content[0].values.tags").doesNotExist())
                .andExpect(jsonPath("$.page.size").value(2))
                .andExpect(jsonPath("$.page.number").value(1))
                .andExpect(jsonPath("$.page.totalElements").value(4))
                .andExpect(jsonPath("$.page.totalPages").value(2));
        mvc.perform(get(records).param("where", "role == 'lead' && joined > '2020-01-01'")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].displayName").value("Ada"));
        mvc.perform(get(records).param("q", "D").param("sort", "level,desc")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].displayName").value("Ada"));

        mvc.perform(get(records).param("where", "role == 'lead' )").header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.column").value(16));
        mvc.perform(get(records).param("sort", "tags,asc").header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isBadRequest());
        mvc.perform(get(records).param("sort", "level,sideways").header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isBadRequest());
        mvc.perform(get(records).param("where", "nope == 1").header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aFolderFilterNarrowsTheListing() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        JsonNode leads = json(mvc.perform(post(project(fx) + "/folders")
                .header(HttpHeaders.AUTHORIZATION, bearer(fx.editorToken()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"displayName\":\"Leads\",\"scope\":\"CONTENT\"}")));
        mvc.perform(post(datasets(fx) + "/" + team.uuid() + "/records")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editorToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"folderUuid\":\"" + leads.get("uuid").asText() + "\",\"displayName\":\"Ada\",\"content\":{\"name\":\"Ada\"}}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.folderPath").value("/leads/"));
        record(fx, team, "{\"name\":\"Bob\"}");

        mvc.perform(get(datasets(fx) + "/" + team.uuid() + "/records").param("folder", "leads")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].folderPath").value("/leads/"));
    }

    /**
     * {@code M19.2.1}: a page is a page — 50 lightweight rows (scalar values only) however many records
     * match. Seeded in a few batch revisions; the 5,000-record timing lives in {@code DatasetBenchmark}.
     */
    @Test
    void aPageOfFiftyStaysSmallWhateverTheDatasetSize() throws Exception {
        Fixture fx = newFixture();
        DatasetView team = team(fx);
        for (int chunk = 0; chunk < 3; chunk++) {
            int offset = chunk * 200;
            transactionTemplate.executeWithoutResult(tx -> {
                Revision batch = revisionService.beginBatch(fx.project().getId(), ChangeType.CREATE, "seed", fx.admin().getId());
                RevisionContext batchCtx = RevisionContext.joining(batch, fx.admin().getId(), "seed");
                for (int i = offset; i < offset + 200; i++) {
                    ObjectNode content = objectMapper.createObjectNode()
                            .put("name", "Member " + i)
                            .put("role", i % 5 == 0 ? "lead" : "dev")
                            .put("level", i % 7);
                    content.putArray("tags").addObject().put("tag", "t" + i);
                    recordService.create(
                            new CreateRecordCommand(fx.project().getId(), team.uuid(), null, "Member " + i, content), batchCtx);
                }
            });
        }
        String body = mvc.perform(get(datasets(fx) + "/" + team.uuid() + "/records")
                        .param("size", "50")
                        .param("sort", "level,desc")
                        .param("where", "role == 'dev'")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(50))
                .andExpect(jsonPath("$.page.totalElements").value(480))
                .andExpect(jsonPath("$.content[0].values.level").value(6))
                .andReturn()
                .getResponse()
                .getContentAsString();

        assertThat(body).doesNotContain("\"tags\"").doesNotContain("\"tag\"");
        assertThat(body.length()).isLessThan(20_000);
    }

    // ------------------------------------------------------------------

    private ResultActions postRecord(Fixture fx, String token, String datasetUuid, String content) throws Exception {
        return mvc.perform(post(datasets(fx) + "/" + datasetUuid + "/records")
                .header(HttpHeaders.AUTHORIZATION, bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"displayName\":\"Record\",\"content\":" + content + "}"));
    }

    private ResultActions putRecord(Fixture fx, String token, String uuid, long ifMatch, String content) throws Exception {
        return mvc.perform(put(project(fx) + "/records/" + uuid)
                .header(HttpHeaders.AUTHORIZATION, bearer(token))
                .header(HttpHeaders.IF_MATCH, "\"rev-" + ifMatch + "\"")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":" + content + "}"));
    }

    private void record(Fixture fx, DatasetView dataset, String content) throws Exception {
        JsonNode values = objectMapper.readTree(content);
        recordService.create(
                new CreateRecordCommand(fx.project().getId(), dataset.uuid(), null, values.path("name").asText(), values), fx.ctx());
    }

    private DatasetView team(Fixture fx) {
        return datasetService.create(
                new CreateDatasetCommand(fx.project().getId(), null, "Team", TEAM_CDL, null, null), fx.ctx());
    }

    private String datasetBody(String displayName, String cdl, String titleEditor) throws Exception {
        ObjectNode body = objectMapper.createObjectNode().put("displayName", displayName).put("contentDefinition", cdl);
        if (titleEditor != null) {
            body.put("titleEditor", titleEditor);
        }
        return objectMapper.writeValueAsString(body);
    }

    private static String project(Fixture fx) {
        return "/api/v1/projects/" + fx.project().getKey();
    }

    private static String datasets(Fixture fx) {
        return project(fx) + "/datasets";
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(
                "datasetapi-admin-" + n, "datasetapi-admin-" + n + "@example.com", "Dataset Api Admin " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("datasetapip_" + n, "Dataset Api Project " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");
        AppUser developer = userService.create(
                "datasetapi-dev-" + n, "datasetapi-dev-" + n + "@example.com", "Dataset Api Developer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), developer.getId(), ProjectRole.DEVELOPER, ctx);
        AppUser editor = userService.create(
                "datasetapi-editor-" + n, "datasetapi-editor-" + n + "@example.com", "Dataset Api Editor " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), editor.getId(), ProjectRole.EDITOR, ctx);
        AppUser viewer = userService.create(
                "datasetapi-viewer-" + n, "datasetapi-viewer-" + n + "@example.com", "Dataset Api Viewer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), viewer.getId(), ProjectRole.VIEWER, ctx);
        return new Fixture(project, admin, developer, editor, viewer);
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

        AppUser admin() {
            return admin;
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
