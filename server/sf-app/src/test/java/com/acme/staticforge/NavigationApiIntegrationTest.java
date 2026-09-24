package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * {@link com.acme.staticforge.api.NavigationController} end-to-end tests (spec §17,
 * `M8.1.5`): {@code PageReference} create/rename(startNode)/resolve/delete round-trips
 * through HTTP, target-validation errors surfacing as 422, and role-gated authorization
 * matching the Pages/Channels API's convention (VIEWER for reads, EDITOR for mutations).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class NavigationApiIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;

    @Test
    void treeCreateRenameStartNodeAndResolveRoundTripThroughHttp() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView page = createPage(fx, "Home");

        // create a PageReference under the navigation root
        String createBody = """
                {"displayName":"Home Link","folderUuid":"%s","targetKind":"PAGE","targetAssetUuid":"%s","label":null}
                """.formatted(navRoot.uuid(), page.uuid());
        String createResponse = mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/navigation/references")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Home Link"))
                .andExpect(jsonPath("$.targetKind").value("PAGE"))
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode created = objectMapper.readTree(createResponse);
        UUID refUuid = UUID.fromString(created.get("uuid").asText());
        long refRevision = created.get("revision").asLong();

        // set the navigation root's startNode to this reference via PATCH .../navigation/folders/{uuid}
        String patchFolderBody = """
                {"startNode":{"kind":"PAGE_REFERENCE","assetUuid":"%s"}}
                """.formatted(refUuid);
        mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/navigation/folders/" + navRoot.uuid())
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .header("If-Match", "\"rev-" + navRoot.validFromRevision() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(patchFolderBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.startNode.kind").value("PAGE_REFERENCE"))
                .andExpect(jsonPath("$.startNode.assetUuid").value(refUuid.toString()));

        // resolve reads back the page uuid + canonical path
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/navigation/references/" + refUuid + "/resolve")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pageUuid").value(page.uuid().toString()));

        // tree exposes the resolved startNode — the sole top-level entry is the fixed "All
        // Navigation" root; navRoot(fx)'s own folder (and its startNode) is one level inside it.
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/navigation/tree")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].children[0].resolvedPageUuid").value(page.uuid().toString()))
                .andExpect(jsonPath("$[0].children[0].children[0].uuid").value(refUuid.toString()));

        // rename via PATCH .../references/{uuid}
        String updateBody = """
                {"targetKind":"PAGE","targetAssetUuid":"%s","label":"Overridden"}
                """.formatted(page.uuid());
        mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/navigation/references/" + refUuid)
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .header("If-Match", "\"rev-" + refRevision + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(updateBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.label").value("Overridden"));

        // delete
        mvc.perform(delete("/api/v1/projects/" + fx.project().getKey() + "/navigation/references/" + refUuid)
                        .header("Authorization", "Bearer " + fx.editorToken()))
                .andExpect(status().isNoContent());
    }

    @Test
    void createReferenceRejectsADanglingTargetWith422() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);

        String body = """
                {"displayName":"Broken","folderUuid":"%s","targetKind":"PAGE","targetAssetUuid":"%s","label":null}
                """.formatted(navRoot.uuid(), UUID.randomUUID());
        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/navigation/references")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void createReferenceRejectsAWrongKindTargetWith422() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView page = createPage(fx, "About");

        // declared FOLDER but target is a Page
        String body = """
                {"displayName":"Wrong Kind","folderUuid":"%s","targetKind":"FOLDER","targetAssetUuid":"%s","label":null}
                """.formatted(navRoot.uuid(), page.uuid());
        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/navigation/references")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void mutatingEndpointsRequireEditorRoleAndRejectViewers() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView page = createPage(fx, "Home");

        String body = """
                {"displayName":"Home Link","folderUuid":"%s","targetKind":"PAGE","targetAssetUuid":"%s","label":null}
                """.formatted(navRoot.uuid(), page.uuid());
        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/navigation/references")
                        .header("Authorization", "Bearer " + fx.viewerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());

        // viewers can still read the tree
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/navigation/tree")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk());
    }

    @Test
    void mutatingEndpointsRequireIfMatch() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);

        String patchFolderBody = "{\"displayName\":\"Renamed\"}";
        mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/navigation/folders/" + navRoot.uuid())
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(patchFolderBody))
                .andExpect(status().isPreconditionFailed());
    }

    /** A fresh top-level `NAVIGATION` folder — nothing is pre-provisioned any more, so each test
     * that needs one creates its own. */
    /**
     * The store trees rename straight from their nodes, so the folder and navigation trees must expose
     * each node's revision — the {@code If-Match} both rename endpoints require.
     */
    @Test
    void treesExposeTheRevisionTheirRenamesSendAsIfMatch() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView page = createPage(fx, "About");
        String key = fx.project().getKey();
        String createBody = """
                {"displayName":"About Link","folderUuid":"%s","targetKind":"PAGE","targetAssetUuid":"%s","label":null}
                """.formatted(navRoot.uuid(), page.uuid());
        mvc.perform(post("/api/v1/projects/" + key + "/navigation/references")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk());

        JsonNode navTree = objectMapper.readTree(mvc.perform(get("/api/v1/projects/" + key + "/navigation/tree")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        JsonNode reference = navTree.get(0).get("children").get(0).get("children").get(0);
        mvc.perform(patch("/api/v1/projects/" + key + "/assets/" + reference.get("uuid").asText() + "/display-name")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .header("If-Match", "\"rev-" + reference.get("revision").asLong() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"About Us Link\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("About Us Link"));

        JsonNode folderTree = objectMapper.readTree(mvc.perform(get("/api/v1/projects/" + key + "/folders")
                        .param("scope", "NAVIGATION")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        JsonNode folder = folderTree.get(0).get("children").get(0);
        assertThat(folder.get("uuid").asText()).isEqualTo(navRoot.uuid().toString());
        assertThat(folder.get("revision").asLong()).isEqualTo(navRoot.validFromRevision());
        mvc.perform(put("/api/v1/projects/" + key + "/folders/" + navRoot.uuid())
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .header("If-Match", "\"rev-" + folder.get("revision").asLong() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Main Menu\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Main Menu"));
    }

    private AssetVersionView navRoot(Fixture fx) {
        return folderService.create(null, "Nav Root " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
    }

    private AssetVersionView createPage(Fixture fx, String name) {
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        name + " Template " + SEQ.incrementAndGet(),
                        "content { editor text title { required } }",
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        null),
                fx.ctx());
        return pageService.create(new CreatePageCommand(name, null, pageTemplate.uuid()), fx.ctx());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("navapi-admin-" + n, "navapi-admin-" + n + "@example.com", "Nav Api Admin " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("navapip_" + n, "Nav Api Project " + n, null, null), admin.getId());

        AppUser viewer = userService.create("navapi-viewer-" + n, "navapi-viewer-" + n + "@example.com", "Nav Api Viewer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), viewer.getId(), ProjectRole.VIEWER,
                RevisionContext.of(project.getId(), admin.getId(), "test"));

        return new Fixture(project, admin, viewer);
    }

    private final class Fixture {
        private final Project project;
        private final AppUser admin;
        private final AppUser viewer;

        Fixture(Project project, AppUser admin, AppUser viewer) {
            this.project = project;
            this.admin = admin;
            this.viewer = viewer;
        }

        Project project() {
            return project;
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "test");
        }

        String editorToken() {
            return jwtService.issueAccessToken(admin);
        }

        String viewerToken() {
            return jwtService.issueAccessToken(viewer);
        }
    }
}
