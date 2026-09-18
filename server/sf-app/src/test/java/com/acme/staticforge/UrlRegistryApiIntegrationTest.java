package com.acme.staticforge;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
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
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryRepository;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
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
 * {@link com.acme.staticforge.api.UrlRegistryController} end-to-end tests (`M8.2.4`): list
 * filters (channelKey/area/free-text q) + pagination, the override round-trip reflected in a
 * later list call, all four reset-scope levels through the HTTP endpoint, and role-gated
 * authorization (VIEWER for reads, DEVELOPER for override, PROJECT_ADMIN for reset).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class UrlRegistryApiIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired TemplateService templateService;
    @Autowired UrlRegistryService urlRegistryService;
    @Autowired UrlRegistryRepository urlRegistryRepository;

    @Test
    void listSupportsChannelAreaAndFreeTextFiltersPlusPagination() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView hammer = createPageRef(fx, "Hammer Drill");
        AssetVersionView screw = createPageRef(fx, "Screwdriver");
        urlRegistryService.resolve(hammer.uuid(), "html", UrlArea.GENERATED, fx.ctx());
        urlRegistryService.resolve(screw.uuid(), "html", UrlArea.GENERATED, fx.ctx());
        urlRegistryService.resolve(hammer.uuid(), "html", UrlArea.PREVIEW, fx.ctx());

        // unfiltered: all three entries
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3));

        // area filter
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .param("area", "GENERATED")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2));

        // channelKey filter
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .param("channelKey", "html")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3));

        // free-text q against the joined PageReference label, narrowed by area
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .param("q", "drill")
                        .param("area", "GENERATED")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].pageReferenceLabel").value("Hammer Drill Link"))
                .andExpect(jsonPath("$.content[0].area").value("GENERATED"));

        // pagination
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .param("page", "0")
                        .param("size", "2")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.totalElements").value(3));
    }

    @Test
    void overrideRoundTripsAndIsReflectedInTheNextListCall() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView screw = createPageRef(fx, "Screwdriver Set");
        urlRegistryService.resolve(screw.uuid(), "html", UrlArea.GENERATED, fx.ctx());
        UrlRegistryEntry entry = urlRegistryRepository
                .findByProjectIdAndChannelKeyAndPageReferenceUuidAndAreaAndLocaleKey(fx.project().getId(), "html", screw.uuid(), UrlArea.GENERATED, "")
                .orElseThrow();

        mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/url-registry/" + entry.getId())
                        .header("Authorization", "Bearer " + fx.developerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"url\":\"custom/screwdriver-set.html\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("custom/screwdriver-set.html"))
                .andExpect(jsonPath("$.overridden").value(true));

        String listResponse = mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .param("channelKey", "html")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode content = objectMapper.readTree(listResponse).get("content");
        boolean found = false;
        for (JsonNode row : content) {
            if (row.get("id").asLong() == entry.getId()) {
                found = true;
                org.assertj.core.api.Assertions.assertThat(row.get("url").asText()).isEqualTo("custom/screwdriver-set.html");
                org.assertj.core.api.Assertions.assertThat(row.get("overridden").asBoolean()).isTrue();
            }
        }
        org.assertj.core.api.Assertions.assertThat(found).isTrue();
    }

    @Test
    void resetEntryScopeThroughApiDeletesOnlyThatRow() throws Exception {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        UrlRegistryEntry a = urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/a/"));
        UrlRegistryEntry b = urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/b/"));

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/url-registry/reset")
                        .header("Authorization", "Bearer " + fx.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"entryId\":" + a.getId() + "}"))
                .andExpect(status().isNoContent());

        org.assertj.core.api.Assertions.assertThat(urlRegistryRepository.findById(a.getId())).isEmpty();
        org.assertj.core.api.Assertions.assertThat(urlRegistryRepository.findById(b.getId())).isPresent();
    }

    @Test
    void resetChannelScopeThroughApiDeletesOnlyThatChannel() throws Exception {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/1/"));
        urlRegistryRepository.save(entry(projectId, "markdown", UUID.randomUUID(), UrlArea.GENERATED, "/2/"));

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/url-registry/reset")
                        .header("Authorization", "Bearer " + fx.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"channelKey\":\"html\"}"))
                .andExpect(status().isNoContent());

        org.assertj.core.api.Assertions.assertThat(
                        urlRegistryRepository.search(projectId, "html", null, org.springframework.data.domain.PageRequest.of(0, 10)).getTotalElements())
                .isZero();
        org.assertj.core.api.Assertions.assertThat(urlRegistryRepository
                        .search(projectId, "markdown", null, org.springframework.data.domain.PageRequest.of(0, 10))
                        .getTotalElements())
                .isEqualTo(1);
    }

    @Test
    void resetAreaScopeThroughApiDeletesOnlyThatAreaAcrossChannels() throws Exception {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.PREVIEW, "/1/"));
        urlRegistryRepository.save(entry(projectId, "markdown", UUID.randomUUID(), UrlArea.PREVIEW, "/2/"));
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/3/"));

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/url-registry/reset")
                        .header("Authorization", "Bearer " + fx.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"area\":\"PREVIEW\"}"))
                .andExpect(status().isNoContent());

        org.assertj.core.api.Assertions.assertThat(urlRegistryRepository
                        .search(projectId, null, UrlArea.PREVIEW, org.springframework.data.domain.PageRequest.of(0, 10))
                        .getTotalElements())
                .isZero();
        org.assertj.core.api.Assertions.assertThat(urlRegistryRepository
                        .search(projectId, null, UrlArea.GENERATED, org.springframework.data.domain.PageRequest.of(0, 10))
                        .getTotalElements())
                .isEqualTo(1);
    }

    @Test
    void resetProjectScopeThroughApiDeletesTheWholeProjectOnly() throws Exception {
        Fixture fx = newFixture();
        Fixture other = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/1/"));
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.PREVIEW, "/2/"));
        urlRegistryRepository.save(
                entry(other.project().getId(), "html", UUID.randomUUID(), UrlArea.GENERATED, "/other/"));

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/url-registry/reset")
                        .header("Authorization", "Bearer " + fx.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNoContent());

        org.assertj.core.api.Assertions.assertThat(
                        urlRegistryRepository.search(projectId, null, null, org.springframework.data.domain.PageRequest.of(0, 10)).getTotalElements())
                .isZero();
        org.assertj.core.api.Assertions.assertThat(urlRegistryRepository
                        .search(other.project().getId(), null, null, org.springframework.data.domain.PageRequest.of(0, 10))
                        .getTotalElements())
                .isEqualTo(1);
    }

    @Test
    void overrideRejectsViewerAndReadEndpointStaysOpenToViewer() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView screw = createPageRef(fx, "Wrench");
        urlRegistryService.resolve(screw.uuid(), "html", UrlArea.GENERATED, fx.ctx());
        UrlRegistryEntry entry = urlRegistryRepository
                .findByProjectIdAndChannelKeyAndPageReferenceUuidAndAreaAndLocaleKey(fx.project().getId(), "html", screw.uuid(), UrlArea.GENERATED, "")
                .orElseThrow();

        mvc.perform(patch("/api/v1/projects/" + fx.project().getKey() + "/url-registry/" + entry.getId())
                        .header("Authorization", "Bearer " + fx.viewerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"url\":\"nope.html\"}"))
                .andExpect(status().isForbidden());

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk());
    }

    @Test
    void resetRequiresProjectAdminAndRejectsDeveloper() throws Exception {
        Fixture fx = newFixture();

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/url-registry/reset")
                        .header("Authorization", "Bearer " + fx.developerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden());

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/url-registry/reset")
                        .header("Authorization", "Bearer " + fx.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNoContent());
    }

    // ------------------------------------------------------------------

    private AssetVersionView createPageRef(Fixture fx, String pageDisplayName) {
        AssetVersionView navFolder = navRoot(fx);
        AssetVersionView page = createPage(fx, pageDisplayName);
        return pageReferenceService.create(
                new CreatePageReferenceCommand(pageDisplayName + " Link", navFolder.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), null),
                fx.ctx());
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
                        "content { editor text title { required } }",
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        null),
                fx.ctx());
        return pageService.create(new CreatePageCommand(name, null, pageTemplate.uuid()), fx.ctx());
    }

    private static UrlRegistryEntry entry(long projectId, String channelKey, UUID pageRefUuid, UrlArea area, String url) {
        return new UrlRegistryEntry(projectId, channelKey, pageRefUuid, area, url, Instant.now(), 1L, false);
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create("urlregapi-admin-" + n, "urlregapi-admin-" + n + "@example.com", "UrlRegApi Admin " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("urlregapip_" + n, "UrlRegApi Project " + n, null, null), admin.getId());

        AppUser viewer = userService.create("urlregapi-viewer-" + n, "urlregapi-viewer-" + n + "@example.com", "UrlRegApi Viewer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), viewer.getId(), ProjectRole.VIEWER,
                RevisionContext.of(project.getId(), admin.getId(), "test"));

        AppUser developer = userService.create("urlregapi-dev-" + n, "urlregapi-dev-" + n + "@example.com", "UrlRegApi Dev " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), developer.getId(), ProjectRole.DEVELOPER,
                RevisionContext.of(project.getId(), admin.getId(), "test"));

        return new Fixture(project, admin, viewer, developer);
    }

    private final class Fixture {
        private final Project project;
        private final AppUser admin;
        private final AppUser viewer;
        private final AppUser developer;

        Fixture(Project project, AppUser admin, AppUser viewer, AppUser developer) {
            this.project = project;
            this.admin = admin;
            this.viewer = viewer;
            this.developer = developer;
        }

        Project project() {
            return project;
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "test");
        }

        String adminToken() {
            return jwtService.issueAccessToken(admin);
        }

        String viewerToken() {
            return jwtService.issueAccessToken(viewer);
        }

        String developerToken() {
            return jwtService.issueAccessToken(developer);
        }
    }
}
