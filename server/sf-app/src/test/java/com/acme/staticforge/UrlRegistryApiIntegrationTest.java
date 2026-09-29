package com.acme.staticforge;

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
import com.acme.staticforge.urlregistry.UrlTarget;
import com.acme.staticforge.urlregistry.UrlTargetType;
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
 * {@link com.acme.staticforge.api.UrlRegistryController} end-to-end tests (`M8.2.4`, M32.7): list filters
 * (channel, area, target type, target, free-text q) + pagination, the override round trips (PATCH of a row, PUT of a
 * target) with their errors, the per-asset view, every reset scope through the HTTP endpoint, and role-gated
 * authorization (VIEWER for reads, DEVELOPER for overrides, PROJECT_ADMIN for resets).
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
        AssetVersionView hammer = createPage(fx, "Hammer Drill");
        AssetVersionView screw = createPage(fx, "Screwdriver");
        resolve(fx, hammer, UrlArea.GENERATED);
        resolve(fx, screw, UrlArea.GENERATED);
        resolve(fx, hammer, UrlArea.PREVIEW);

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

        // free-text q against the target's display name, narrowed by area; the target's facts are joined in
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .param("q", "drill")
                        .param("area", "GENERATED")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].targetLabel").value("Hammer Drill"))
                .andExpect(jsonPath("$.content[0].targetType").value("PAGE"))
                .andExpect(jsonPath("$.content[0].targetUuid").value(hammer.uuid().toString()))
                .andExpect(jsonPath("$.content[0].pageNumber").value(1))
                .andExpect(jsonPath("$.content[0].locale").value(""))
                .andExpect(jsonPath("$.content[0].area").value("GENERATED"));

        // target type and target filters
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .param("targetType", "MEDIA")
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .param("targetUuid", screw.uuid().toString())
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));

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
        AssetVersionView screw = createPage(fx, "Screwdriver Set");
        resolve(fx, screw, UrlArea.GENERATED);
        UrlRegistryEntry entry = row(fx, screw, UrlArea.GENERATED);

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
        UrlRegistryEntry a = urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "a.html"));
        UrlRegistryEntry b = urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "b.html"));

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
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "1.html"));
        urlRegistryRepository.save(entry(projectId, "markdown", UUID.randomUUID(), UrlArea.GENERATED, "2.html"));

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/url-registry/reset")
                        .header("Authorization", "Bearer " + fx.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"channelKey\":\"html\"}"))
                .andExpect(status().isNoContent());

        org.assertj.core.api.Assertions.assertThat(
                        urlRegistryService.search(projectId, new UrlRegistryService.Filter("html", null, null, null, null, null), org.springframework.data.domain.Pageable.unpaged()).getTotalElements())
                .isZero();
        org.assertj.core.api.Assertions.assertThat(urlRegistryService.search(projectId, new UrlRegistryService.Filter("markdown", null, null, null, null, null), org.springframework.data.domain.Pageable.unpaged())
                        .getTotalElements())
                .isEqualTo(1);
    }

    @Test
    void resetAreaScopeThroughApiDeletesOnlyThatAreaAcrossChannels() throws Exception {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.PREVIEW, "1.html"));
        urlRegistryRepository.save(entry(projectId, "markdown", UUID.randomUUID(), UrlArea.PREVIEW, "2.html"));
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "3.html"));

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/url-registry/reset")
                        .header("Authorization", "Bearer " + fx.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"area\":\"PREVIEW\"}"))
                .andExpect(status().isNoContent());

        org.assertj.core.api.Assertions.assertThat(urlRegistryService.search(projectId, new UrlRegistryService.Filter(null, UrlArea.PREVIEW, null, null, null, null), org.springframework.data.domain.Pageable.unpaged())
                        .getTotalElements())
                .isZero();
        org.assertj.core.api.Assertions.assertThat(urlRegistryService.search(projectId, new UrlRegistryService.Filter(null, UrlArea.GENERATED, null, null, null, null), org.springframework.data.domain.Pageable.unpaged())
                        .getTotalElements())
                .isEqualTo(1);
    }

    @Test
    void resetProjectScopeThroughApiDeletesTheWholeProjectOnly() throws Exception {
        Fixture fx = newFixture();
        Fixture other = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "1.html"));
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.PREVIEW, "2.html"));
        urlRegistryRepository.save(
                entry(other.project().getId(), "html", UUID.randomUUID(), UrlArea.GENERATED, "other.html"));

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/url-registry/reset")
                        .header("Authorization", "Bearer " + fx.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNoContent());

        org.assertj.core.api.Assertions.assertThat(
                        urlRegistryService.search(projectId, new UrlRegistryService.Filter(null, null, null, null, null, null), org.springframework.data.domain.Pageable.unpaged()).getTotalElements())
                .isZero();
        org.assertj.core.api.Assertions.assertThat(urlRegistryService.search(other.project().getId(), new UrlRegistryService.Filter(null, null, null, null, null, null), org.springframework.data.domain.Pageable.unpaged())
                        .getTotalElements())
                .isEqualTo(1);
    }

    @Test
    void overrideRejectsViewerAndReadEndpointStaysOpenToViewer() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView screw = createPage(fx, "Wrench");
        resolve(fx, screw, UrlArea.GENERATED);
        UrlRegistryEntry entry = row(fx, screw, UrlArea.GENERATED);

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

    @Test
    void putSetsAnAssetsUrlBeforeAnyRowExistsAndRefusesATakenUrl() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView about = createPage(fx, "About");
        AssetVersionView team = createPage(fx, "Team");
        resolve(fx, about, UrlArea.GENERATED);

        mvc.perform(put("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .header("Authorization", "Bearer " + fx.developerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetType\":\"PAGE\",\"targetUuid\":\"" + team.uuid()
                                + "\",\"channelKey\":\"html\",\"area\":\"GENERATED\",\"url\":\"/company/team.html\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("company/team.html"))
                .andExpect(jsonPath("$.overridden").value(true))
                .andExpect(jsonPath("$.targetLabel").value("Team"));

        mvc.perform(put("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .header("Authorization", "Bearer " + fx.developerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetType\":\"PAGE\",\"targetUuid\":\"" + team.uuid()
                                + "\",\"channelKey\":\"html\",\"area\":\"GENERATED\",\"url\":\"about.html\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0200"))
                .andExpect(jsonPath("$.holderUuid").value(about.uuid().toString()));

        mvc.perform(put("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .header("Authorization", "Bearer " + fx.developerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetType\":\"PAGE\",\"targetUuid\":\"" + team.uuid()
                                + "\",\"channelKey\":\"html\",\"area\":\"GENERATED\",\"url\":\"../up.html\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0201"));

        mvc.perform(put("/api/v1/projects/" + fx.project().getKey() + "/url-registry")
                        .header("Authorization", "Bearer " + fx.viewerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetType\":\"PAGE\",\"targetUuid\":\"" + team.uuid()
                                + "\",\"channelKey\":\"html\",\"area\":\"GENERATED\",\"url\":\"v.html\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void assetEndpointListsAnAssetsRowsAndAFoldersIndexPage() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        AssetVersionView index = createPage(fx, "Index", products.uuid());
        resolve(fx, index, UrlArea.GENERATED);
        resolve(fx, index, UrlArea.PREVIEW);

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry/assets/" + index.uuid())
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetType").value("PAGE"))
                .andExpect(jsonPath("$.entries.length()").value(2))
                .andExpect(jsonPath("$.indexPages.length()").value(0));

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/url-registry/assets/" + products.uuid())
                        .header("Authorization", "Bearer " + fx.viewerToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetType").value("FOLDER"))
                .andExpect(jsonPath("$.entries.length()").value(0))
                .andExpect(jsonPath("$.indexPages[0].channelKey").value("html"))
                .andExpect(jsonPath("$.indexPages[0].pageUuid").value(index.uuid().toString()))
                .andExpect(jsonPath("$.indexPages[0].pageLabel").value("Index"));
    }

    @Test
    void resetAssetScopeThroughApiDeletesTheAssetsRows() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = createPage(fx, "Gone");
        AssetVersionView kept = createPage(fx, "Kept");
        resolve(fx, page, UrlArea.GENERATED);
        resolve(fx, page, UrlArea.PREVIEW);
        resolve(fx, kept, UrlArea.GENERATED);

        mvc.perform(post("/api/v1/projects/" + fx.project().getKey() + "/url-registry/reset")
                        .header("Authorization", "Bearer " + fx.adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetUuid\":\"" + page.uuid() + "\",\"area\":\"GENERATED\"}"))
                .andExpect(status().isNoContent());

        org.assertj.core.api.Assertions.assertThat(urlRegistryRepository.findByProjectIdAndTargetUuid(fx.project().getId(), page.uuid()))
                .singleElement().extracting(UrlRegistryEntry::getArea).isEqualTo(UrlArea.PREVIEW);
        org.assertj.core.api.Assertions.assertThat(urlRegistryRepository.findByProjectIdAndTargetUuid(fx.project().getId(), kept.uuid()))
                .hasSize(1);
    }

    // ------------------------------------------------------------------

    private void resolve(Fixture fx, AssetVersionView page, UrlArea area) {
        urlRegistryService.resolvePage(page.uuid(), 1, "html", area, null, fx.ctx());
    }

    private UrlRegistryEntry row(Fixture fx, AssetVersionView page, UrlArea area) {
        return urlRegistryRepository.findTuple(fx.project().getId(), "html", area, "", UrlTargetType.PAGE, page.uuid(), "", 1)
                .orElseThrow();
    }

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
        return createPage(fx, name, null);
    }

    private AssetVersionView createPage(Fixture fx, String name, UUID folder) {
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
        return pageService.create(new CreatePageCommand(name, folder, pageTemplate.uuid()), fx.ctx());
    }

    private static UrlRegistryEntry entry(long projectId, String channelKey, UUID page, UrlArea area, String url) {
        return new UrlRegistryEntry(projectId, channelKey, UrlTarget.page(page), area, "", url, Instant.now(), 1L, false);
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
