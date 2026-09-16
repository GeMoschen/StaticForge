package com.acme.staticforge;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

/**
 * {@link com.acme.staticforge.api.GlobalsController} over HTTP (M17.2.1, spec §20.2).
 *
 * <p>The split between {@code PUT /{uuid}/schema} and {@code PUT /{uuid}/content} is the whole
 * point of this controller, so the role matrix is what these tests really guard: declaring the
 * fields is a {@code DEVELOPER} act and filling them in an {@code EDITOR} one, and a single
 * endpoint would have had to infer that from which fields changed. The rest is the protocol every
 * store endpoint shares — {@code ETag} on every response, {@code If-Match} required on mutations,
 * {@code 409} on a stale one, {@code 422} carrying {@code SF-CDL-*} diagnostics or field-level
 * {@code issues} — plus §8.4's rule that another project's uuid is {@code 404}, never {@code 403}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GlobalsApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String SITE_CDL =
            """
            content {
              editor text title { label "Site title" required default "Acme" }
              editor boolean showBanner { label "Show banner" default false }
            }
            """;

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired GlobalSetService globalSetService;

    @Test
    void aDeveloperDrivesTheWholeLifecycleAndEveryResponseCarriesAnEtag() throws Exception {
        Fixture fx = newFixture();

        JsonNode created = json(mvc.perform(post(globals(fx))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Site", SITE_CDL)))
                .andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.ETAG, etagMatcherForAnyRevision()))
                .andExpect(jsonPath("$.uid").value("site"))
                .andExpect(jsonPath("$.content.title").value("Acme")));
        String uuid = created.get("uuid").asText();
        long revision = created.get("revision").asLong();

        mvc.perform(get(globals(fx)).header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].uuid").value(uuid));
        mvc.perform(get(globals(fx) + "/" + uuid).header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken())))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"rev-" + revision + "\""))
                .andExpect(jsonPath("$.contentDefinition").value(SITE_CDL));

        JsonNode valued = json(putContent(fx, fx.editorToken(), uuid, revision, "{\"title\":\"Acme Outdoor\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.title").value("Acme Outdoor")));
        long valuedRevision = valued.get("revision").asLong();
        mvc.perform(get(globals(fx) + "/" + uuid + "?revision=" + revision)
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"rev-" + revision + "\""))
                .andExpect(jsonPath("$.content.title").value("Acme"));

        // A rename through /schema migrates the value in the same write, so the reply already
        // carries the new key — the UI never has to re-fetch to see where the value went.
        putSchema(fx, fx.developerToken(), uuid, valuedRevision,
                """
                content {
                  editor text siteTitle { label "Site title" required renamedFrom "title" }
                  editor boolean showBanner { label "Show banner" default false }
                }
                """)
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, etagMatcherForAnyRevision()))
                .andExpect(jsonPath("$.content.siteTitle").value("Acme Outdoor"))
                .andExpect(jsonPath("$.content.title").doesNotExist());

        mvc.perform(delete(globals(fx) + "/" + uuid).header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken())))
                .andExpect(status().isNoContent());
        mvc.perform(get(globals(fx)).header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void aViewerReadsEverythingAndWritesNothing() throws Exception {
        Fixture fx = newFixture();
        GlobalSetView site = site(fx);

        mvc.perform(get(globals(fx)).header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isOk());
        mvc.perform(get(globals(fx) + "/" + site.uuid()).header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"rev-" + site.revision() + "\""));

        mvc.perform(post(globals(fx))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Other", SITE_CDL)))
                .andExpect(status().isForbidden());
        putContent(fx, fx.viewerToken(), site.uuid().toString(), site.revision(), "{\"title\":\"Nope\"}")
                .andExpect(status().isForbidden());
        putSchema(fx, fx.viewerToken(), site.uuid().toString(), site.revision(), SITE_CDL)
                .andExpect(status().isForbidden());
        mvc.perform(delete(globals(fx) + "/" + site.uuid())
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isForbidden());
    }

    /** The split's reason for existing: an editor fills values in and never touches the schema. */
    @Test
    void anEditorWritesValuesButIsRefusedTheSchema() throws Exception {
        Fixture fx = newFixture();
        GlobalSetView site = site(fx);

        putContent(fx, fx.editorToken(), site.uuid().toString(), site.revision(), "{\"title\":\"Acme Outdoor\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.title").value("Acme Outdoor"));

        putSchema(fx, fx.editorToken(), site.uuid().toString(), site.revision() + 1, SITE_CDL)
                .andExpect(status().isForbidden());
        mvc.perform(post(globals(fx))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editorToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Other", SITE_CDL)))
                .andExpect(status().isForbidden());
        mvc.perform(delete(globals(fx) + "/" + site.uuid())
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editorToken())))
                .andExpect(status().isForbidden());
    }

    /**
     * §8.4: addressing another project's set through a project the caller is a developer of must
     * not tell them whether that uuid exists — so every operation is {@code 404}, the same answer
     * a made-up uuid gets, rather than a {@code 403} that would confirm it.
     */
    @Test
    void aSetOwnedByAnotherProjectIsNotFoundRatherThanForbidden() throws Exception {
        Fixture fx = newFixture();
        Fixture other = newFixture();
        GlobalSetView foreign = site(other);

        mvc.perform(get(globals(fx) + "/" + foreign.uuid())
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewerToken())))
                .andExpect(status().isNotFound());
        putContent(fx, fx.editorToken(), foreign.uuid().toString(), foreign.revision(), "{\"title\":\"Leak\"}")
                .andExpect(status().isNotFound());
        putSchema(fx, fx.developerToken(), foreign.uuid().toString(), foreign.revision(), SITE_CDL)
                .andExpect(status().isNotFound());
        mvc.perform(delete(globals(fx) + "/" + foreign.uuid())
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken())))
                .andExpect(status().isNotFound());
    }

    @Test
    void mutationsRequireAnIfMatchAndConflictOnAStaleOne() throws Exception {
        Fixture fx = newFixture();
        GlobalSetView site = site(fx);

        mvc.perform(put(globals(fx) + "/" + site.uuid() + "/content")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editorToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":{\"title\":\"Acme Outdoor\"},\"comment\":null}"))
                .andExpect(status().isPreconditionFailed());
        mvc.perform(put(globals(fx) + "/" + site.uuid() + "/schema")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                objectMapper.createObjectNode().put("contentDefinition", SITE_CDL))))
                .andExpect(status().isPreconditionFailed());

        putContent(fx, fx.editorToken(), site.uuid().toString(), site.revision(), "{\"title\":\"First\"}")
                .andExpect(status().isOk());

        // Same If-Match a second time: the same conflict document a page save produces.
        putContent(fx, fx.editorToken(), site.uuid().toString(), site.revision(), "{\"title\":\"Second\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-API-0409"))
                .andExpect(jsonPath("$.expectedRevision").value(site.revision()))
                .andExpect(jsonPath("$.base").exists())
                .andExpect(jsonPath("$.theirs").exists());
        putSchema(fx, fx.developerToken(), site.uuid().toString(), site.revision(), SITE_CDL)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-API-0409"));
    }

    @Test
    void cdlErrorsAreReportedAs422DiagnosticsOnCreateAndOnSchemaUpdate() throws Exception {
        Fixture fx = newFixture();

        mvc.perform(post(globals(fx))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Broken", "content { editor text title { } editor text title { } }")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-API-0422"))
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.CDL_DUPLICATE_EDITOR))
                .andExpect(jsonPath("$.diagnostics[0].severity").value("ERROR"));

        GlobalSetView site = site(fx);
        putSchema(fx, fx.developerToken(), site.uuid().toString(), site.revision(),
                """
                content { editor text title { label "Title" } }
                bodies { body main { label "Main" allow ["*"] } }
                """)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.CDL_NOT_ALLOWED_IN_GLOBAL_SET));

        // A value that is malformed for its editor is the other 422 shape: field-level `issues`.
        putContent(fx, fx.editorToken(), site.uuid().toString(), site.revision(), "{\"title\":{\"nope\":1}}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-API-0422"))
                .andExpect(jsonPath("$.issues[0].path").value("content.title"))
                .andExpect(jsonPath("$.issues[0].kind").value("STRUCTURAL"));
    }

    /**
     * The schema editor validates drafts through the shared {@code POST /cdl/validate}. Without
     * {@code kind} it is the plain language check (a body is legal — that CDL is fine for a
     * template); with {@code kind=GLOBAL_SET} it reports exactly what the save would refuse.
     */
    @Test
    void draftValidationAppliesTheSetRestrictionsOnlyForKindGlobalSet() throws Exception {
        Fixture fx = newFixture();
        String withBody = """
                content { editor text title { label "Title" } }
                bodies { body main { label "Main" allow ["*"] } }
                """;
        String body = objectMapper.writeValueAsString(objectMapper.createObjectNode().put("source", withBody));

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/cdl/validate")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.diagnostics.length()").value(0));

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/cdl/validate?kind=GLOBAL_SET")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.developerToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.diagnostics[0].code").value(DiagnosticCodes.CDL_NOT_ALLOWED_IN_GLOBAL_SET));
    }

    // ------------------------------------------------------------------
    // Request helpers
    // ------------------------------------------------------------------

    private ResultActions putContent(Fixture fx, String token, String uuid, long ifMatch, String content)
            throws Exception {
        return mvc.perform(put(globals(fx) + "/" + uuid + "/content")
                .header(HttpHeaders.AUTHORIZATION, bearer(token))
                .header(HttpHeaders.IF_MATCH, "\"rev-" + ifMatch + "\"")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":" + content + ",\"comment\":null}"));
    }

    private ResultActions putSchema(Fixture fx, String token, String uuid, long ifMatch, String cdl) throws Exception {
        return mvc.perform(put(globals(fx) + "/" + uuid + "/schema")
                .header(HttpHeaders.AUTHORIZATION, bearer(token))
                .header(HttpHeaders.IF_MATCH, "\"rev-" + ifMatch + "\"")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        objectMapper.createObjectNode().put("contentDefinition", cdl))));
    }

    private String createBody(String displayName, String cdl) throws Exception {
        return objectMapper.writeValueAsString(objectMapper.createObjectNode()
                .put("displayName", displayName)
                .put("contentDefinition", cdl));
    }

    private static String globals(Fixture fx) {
        return "/api/v1/projects/" + fx.project().getKey() + "/globals";
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private static org.hamcrest.Matcher<String> etagMatcherForAnyRevision() {
        return org.hamcrest.Matchers.matchesPattern("\"rev-\\d+\"");
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private GlobalSetView site(Fixture fx) {
        return globalSetService.create(
                new CreateGlobalSetCommand(fx.project().getId(), null, "Site", SITE_CDL), fx.ctx());
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(
                "globalsapi-admin-" + n, "globalsapi-admin-" + n + "@example.com", "Globals Api Admin " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("globalsapip_" + n, "Globals Api Project " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");

        AppUser developer = userService.create(
                "globalsapi-dev-" + n, "globalsapi-dev-" + n + "@example.com", "Globals Api Developer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), developer.getId(), ProjectRole.DEVELOPER, ctx);
        AppUser editor = userService.create(
                "globalsapi-editor-" + n, "globalsapi-editor-" + n + "@example.com", "Globals Api Editor " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), editor.getId(), ProjectRole.EDITOR, ctx);
        AppUser viewer = userService.create(
                "globalsapi-viewer-" + n, "globalsapi-viewer-" + n + "@example.com", "Globals Api Viewer " + n, "secret-password");
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
