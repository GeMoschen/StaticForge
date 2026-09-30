package com.acme.staticforge;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.template.cdl.CdlSources;
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
 * {@link com.acme.staticforge.api.AssetController#renameDisplayName} end-to-end tests
 * (M12 Feature 1, Task 1): the generic {@code PATCH .../assets/{uuid}/display-name}
 * endpoint renaming a PAGE and a PAGE_REFERENCE without touching their payload/target
 * fields, and the standard stale-If-Match concurrency behavior other mutating asset
 * endpoints already have.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AssetRenameApiIntegrationTest {

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
    void renamesPageDisplayNameAndLeavesContentPayloadUntouched() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = createPage(fx, "Home");
        JsonNode originalPayload = page.payload();

        String body = "{\"displayName\":\"Renamed Home\"}";
        String response = mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/assets/" + page.uuid() + "/display-name")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .header("If-Match", "\"rev-" + page.validFromRevision() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Renamed Home"))
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode updated = objectMapper.readTree(response);
        assertPayloadUnchanged(originalPayload, updated.get("payload"));

        AssetVersionView current = assetService.requireCurrent(fx.project().getId(), page.uuid());
        org.assertj.core.api.Assertions.assertThat(current.displayName()).isEqualTo("Renamed Home");
        org.assertj.core.api.Assertions.assertThat(current.payload()).isEqualTo(originalPayload);
    }

    @Test
    void renamesPageReferenceDisplayNameAndLeavesTargetUntouched() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView page = createPage(fx, "About");

        String createBody = """
                {"displayName":"About Link","folderUuid":"%s","targetKind":"PAGE","targetAssetUuid":"%s","label":null}
                """.formatted(navRoot.uuid(), page.uuid());
        String createResponse = mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/navigation/references")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode created = objectMapper.readTree(createResponse);
        UUID refUuid = UUID.fromString(created.get("uuid").asText());
        long refRevision = created.get("revision").asLong();

        String renameBody = "{\"displayName\":\"About Link Renamed\"}";
        mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/assets/" + refUuid + "/display-name")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .header("If-Match", "\"rev-" + refRevision + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(renameBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("About Link Renamed"));

        AssetVersionView currentRef = assetService.requireCurrent(fx.project().getId(), refUuid);
        org.assertj.core.api.Assertions.assertThat(currentRef.displayName()).isEqualTo("About Link Renamed");
        org.assertj.core.api.Assertions.assertThat(currentRef.payload().get("target").get("kind").asText())
                .isEqualTo("PAGE");
        org.assertj.core.api.Assertions.assertThat(currentRef.payload().get("target").get("assetUuid").asText())
                .isEqualTo(page.uuid().toString());
    }

    @Test
    void staleIfMatchOnDisplayNameRenameReturns409() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = createPage(fx, "Contact");

        // First rename succeeds and advances the revision.
        mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/assets/" + page.uuid() + "/display-name")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .header("If-Match", "\"rev-" + page.validFromRevision() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Contact Us\"}"))
                .andExpect(status().isOk());

        // Second rename replays the now-stale original revision.
        mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/assets/" + page.uuid() + "/display-name")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .header("If-Match", "\"rev-" + page.validFromRevision() + "\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Stale Name\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-API-0409"));
    }

    @Test
    void missingIfMatchOnDisplayNameRenameReturns412() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = createPage(fx, "Team");

        mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/assets/" + page.uuid() + "/display-name")
                        .header("Authorization", "Bearer " + fx.editorToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Team Renamed\"}"))
                .andExpect(status().isPreconditionFailed());
    }

    private void assertPayloadUnchanged(JsonNode expected, JsonNode actual) {
        org.assertj.core.api.Assertions.assertThat(actual).isEqualTo(expected);
    }

    /** A fresh top-level `NAVIGATION` folder — nothing is pre-provisioned any more, so each test
     * that needs one creates its own. */
    private AssetVersionView navRoot(Fixture fx) {
        return folderService.create(null, "Nav Root " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
    }

    private AssetVersionView createPage(Fixture fx, String name) {
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        name + " Template " + SEQ.incrementAndGet(),
                        CdlSources.split("content { editor text title { required } }"),
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        null),
                fx.ctx());
        return pageService.create(new CreatePageCommand(name, null, pageTemplate.uuid()), fx.ctx());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(
                "rename-admin-" + n, "rename-admin-" + n + "@example.com", "Rename Admin " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("renamep_" + n, "Rename Project " + n, null, null), admin.getId());
        return new Fixture(project, admin);
    }

    private final class Fixture {
        private final Project project;
        private final AppUser admin;

        Fixture(Project project, AppUser admin) {
            this.project = project;
            this.admin = admin;
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
    }
}
