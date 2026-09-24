package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditLogRepository;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.preview.PreviewTokenService;
import com.acme.staticforge.project.ProjectMemberRepository;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.search.SearchIndexer;
import com.acme.staticforge.search.SearchService;
import com.acme.staticforge.security.RefreshCookieService;
import com.acme.staticforge.urlregistry.ResetScope;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Archived projects (M26.2.1): hidden from members on their next request, read-only for everyone
 * ({@code 409 SF-DOM-0141}), share links dead, no generation, and {@code unarchive} restores all of it.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ArchivedProjectIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String PASSWORD = "secret-password";
    private static final String ARCHIVED = "SF-DOM-0141";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired AppUserRepository users;
    @Autowired ProjectService projectService;
    @Autowired ProjectMemberRepository members;
    @Autowired RevisionRepository revisions;
    @Autowired AuditLogRepository auditLog;
    @Autowired AssetService assets;
    @Autowired TemplateService templates;
    @Autowired SearchService search;
    @Autowired SearchIndexer indexer;
    @Autowired PreviewTokenService previewTokens;
    @Autowired UrlRegistryService urlRegistry;

    private SearchFixtures fixtures;
    private SearchFixtures.Fixture fx;
    private AppUser admin;
    private AppUser editor;
    private AssetVersionView page;

    private record Session(String accessToken, Cookie refreshCookie) {}

    @BeforeEach
    void setUp() {
        fixtures = new SearchFixtures(userService, projectService, assets, templates, search, indexer);
        fx = fixtures.project("arch");
        admin = newUser("arch-admin");
        admin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        admin = users.save(admin);
        editor = newUser("arch-editor");
        projectService.setMemberRole(fx.key(), editor.getId(), ProjectRole.EDITOR, fx.ctx());
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        page = fixtures.page(fx, "Archive Page", template.uuid(), "zanzibarquokka", "<p>body</p>");
    }

    // ---------------------------------------------------------------- helpers

    private AppUser newUser(String prefix) {
        int n = SEQ.incrementAndGet();
        return userService.create(prefix + "-" + n, prefix + "-" + n + "@example.com", prefix + " " + n, PASSWORD);
    }

    private Session login(AppUser user) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("username", user.getUsername(), "password", PASSWORD))))
                .andExpect(status().isOk())
                .andReturn();
        return session(result);
    }

    private Session refresh(Session session) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/refresh")
                        .cookie(session.refreshCookie())
                        .header("X-Requested-With", "XMLHttpRequest"))
                .andExpect(status().isOk())
                .andReturn();
        return session(result);
    }

    private Session session(MvcResult result) throws Exception {
        String token = objectMapper.readTree(result.getResponse().getContentAsString()).get("accessToken").asText();
        return new Session(token, result.getResponse().getCookie(RefreshCookieService.COOKIE_NAME));
    }

    private ResultActions as(Session session, MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + session.accessToken()));
    }

    private ResultActions asJson(Session session, MockHttpServletRequestBuilder request, Object body) throws Exception {
        return as(session, request.contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body)));
    }

    private void archive(Session adminSession) throws Exception {
        as(adminSession, post("/api/v1/projects/" + fx.key() + "/archive")).andExpect(status().isNoContent());
    }

    private void unarchive(Session adminSession) throws Exception {
        as(adminSession, post("/api/v1/projects/" + fx.key() + "/unarchive")).andExpect(status().isNoContent());
    }

    private List<JsonNode> projects(Session session) throws Exception {
        JsonNode list = objectMapper.readTree(
                as(session, get("/api/v1/projects")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        return java.util.stream.StreamSupport.stream(list.spliterator(), false).toList();
    }

    private List<String> projectKeys(Session session) throws Exception {
        return projects(session).stream().map(p -> p.get("key").asText()).toList();
    }

    private JsonNode summary(Session session) throws Exception {
        return projects(session).stream().filter(p -> p.get("key").asText().equals(fx.key())).findFirst().orElseThrow();
    }

    private static void expectArchived(ResultActions actions) throws Exception {
        actions.andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(ARCHIVED))
                .andExpect(jsonPath("$.title").value("Project is archived"));
    }

    // ---------------------------------------------------------------- tests

    @Test
    void membersLoseTheProjectOnTheirNextRequestAndGetItBackAfterUnarchive() throws Exception {
        Session member = login(editor);
        as(member, get("/api/v1/projects/" + fx.key())).andExpect(status().isOk());
        assertThat(projectKeys(member)).contains(fx.key());

        Session adminSession = login(admin);
        archive(adminSession);

        // The still-valid token was revoked by the epoch bump; the refreshed one no longer lists the project.
        as(member, get("/api/v1/projects/" + fx.key())).andExpect(status().isUnauthorized());
        member = refresh(member);
        as(member, get("/api/v1/projects/" + fx.key())).andExpect(status().isNotFound());
        as(member, get("/api/v1/projects/" + fx.key() + "/assets/" + page.uuid())).andExpect(status().isNotFound());
        // A write is a 404 too, not the 409 an admin gets: the project's existence stays hidden.
        asJson(member, put("/api/v1/projects/" + fx.key()), Map.of("name", "Renamed")).andExpect(status().isNotFound());
        assertThat(projectKeys(member)).doesNotContain(fx.key());
        JsonNode me = objectMapper.readTree(
                as(member, get("/api/v1/auth/me")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(me.get("projectRoles").has(fx.key())).isFalse();
        assertThat(me.get("memberships").findValuesAsText("projectKey")).doesNotContain(fx.key());

        unarchive(adminSession);

        as(member, get("/api/v1/projects/" + fx.key())).andExpect(status().isUnauthorized());
        member = refresh(member);
        as(member, get("/api/v1/projects/" + fx.key())).andExpect(status().isOk());
        assertThat(projectKeys(member)).contains(fx.key());
        // The old role came back with it.
        asJson(member, put("/api/v1/projects/" + fx.key()), Map.of("name", "Renamed"))
                .andExpect(status().isForbidden());
        assertThat(summary(member).get("yourRole").asText()).isEqualTo("EDITOR");
    }

    @Test
    void instanceAdminsSeeAndReadAnArchivedProjectButCannotWriteToIt() throws Exception {
        Session adminSession = login(admin);
        long revisionsBefore = revisions.findByProjectIdOrderByRevisionIdDesc(fx.projectId()).size();
        archive(adminSession);

        assertThat(summary(adminSession).get("archived").asBoolean()).isTrue();
        as(adminSession, get("/api/v1/projects/" + fx.key()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(true));
        as(adminSession, get("/api/v1/projects/" + fx.key() + "/assets/" + page.uuid())).andExpect(status().isOk());
        as(adminSession, get("/api/v1/projects/" + fx.key() + "/preview/pages/" + page.uuid()))
                .andExpect(status().isOk());

        expectArchived(asJson(adminSession, put("/api/v1/projects/" + fx.key()), Map.of("name", "Renamed")));
        expectArchived(asJson(adminSession, put("/api/v1/projects/" + fx.key() + "/members/" + admin.getId()),
                Map.of("role", "VIEWER")));
        expectArchived(as(adminSession, delete("/api/v1/projects/" + fx.key() + "/members/" + editor.getId())));
        expectArchived(as(adminSession, delete("/api/v1/projects/" + fx.key() + "/assets/" + page.uuid())));
        expectArchived(asJson(adminSession, post("/api/v1/projects/" + fx.key() + "/generations"), Map.of()));
        expectArchived(as(adminSession, post("/api/v1/projects/" + fx.key() + "/generations/1/promote")));
        expectArchived(as(adminSession, post("/api/v1/projects/" + fx.key() + "/search/reindex")));
        expectArchived(as(adminSession, get("/api/v1/projects/" + fx.key() + "/preview/pages/" + page.uuid() + "/share")));

        // Only the archive itself wrote a revision; the refused writes left nothing behind.
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(fx.projectId())).hasSize((int) revisionsBefore + 1);
        assertThat(members.findByProjectIdAndUserId(fx.projectId(), editor.getId())).isPresent();
        assertThat(projectService.requireByKey(fx.key()).getName()).isNotEqualTo("Renamed");

        // Archiving twice changes nothing.
        archive(adminSession);
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(fx.projectId())).hasSize((int) revisionsBefore + 1);
    }

    @Test
    void archiveAndUnarchiveAreAuditedAndReservedToInstanceAdmins() throws Exception {
        Session owner = login(fx.user());
        as(owner, post("/api/v1/projects/" + fx.key() + "/archive")).andExpect(status().isForbidden());

        Session adminSession = login(admin);
        archive(adminSession);
        owner = refresh(owner);
        as(owner, post("/api/v1/projects/" + fx.key() + "/unarchive")).andExpect(status().isForbidden());
        unarchive(adminSession);

        List<AuditLog> entries = auditLog.findAll().stream()
                .filter(e -> fx.projectId() == (e.getProjectId() == null ? -1L : e.getProjectId()))
                .filter(e -> e.getAction().startsWith("PROJECT_"))
                .toList();
        assertThat(entries).extracting(AuditLog::getAction).containsExactly("PROJECT_ARCHIVED", "PROJECT_UNARCHIVED");
        assertThat(entries).allSatisfy(e -> {
            assertThat(e.getTarget()).isEqualTo("project:" + fx.key());
            assertThat(e.getActorUserId()).isEqualTo(admin.getId());
        });

        // Writable again.
        asJson(adminSession, put("/api/v1/projects/" + fx.key()), Map.of("name", "Back in business"))
                .andExpect(status().isOk());
    }

    @Test
    void shareLinksIssuedBeforeArchivingStopWorkingAndComeBackAfterUnarchive() throws Exception {
        Session adminSession = login(admin);
        String url = objectMapper.readTree(as(adminSession,
                        get("/api/v1/projects/" + fx.key() + "/preview/pages/" + page.uuid() + "/share"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString()).get("url").asText();
        String mediaToken = previewTokens.issueMediaShareToken(UUID.randomUUID(), null, fx.key());
        mvc.perform(get(url)).andExpect(status().isOk());

        archive(adminSession);

        mvc.perform(get(url)).andExpect(status().isNotFound());
        UUID mediaUuid = UUID.fromString(objectMapper.readTree(java.util.Base64.getUrlDecoder()
                .decode(mediaToken.split("\\.")[1])).get("pageUuid").asText());
        mvc.perform(get("/api/v1/projects/" + fx.key() + "/media/" + mediaUuid + "/share").param("t", mediaToken))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail").value("Project not found."));

        unarchive(adminSession);
        mvc.perform(get(url)).andExpect(status().isOk());
    }

    @Test
    void unarchiveBringsTheProjectBackIntoSearchWithoutAManualReindex() throws Exception {
        assertThat(fixtures.find(fx, "zanzibarquokka")).containsExactly(page.uuid());

        Session adminSession = login(admin);
        archive(adminSession);
        fixtures.awaitIndexed();
        unarchive(adminSession);

        assertThat(fixtures.find(fx, "zanzibarquokka")).containsExactly(page.uuid());
    }

    @Test
    void deletingAnAccountRemovesItsMembershipOfAnArchivedProject() throws Exception {
        Session adminSession = login(admin);
        archive(adminSession);
        long revisionsBefore = revisions.findByProjectIdOrderByRevisionIdDesc(fx.projectId()).size();

        as(adminSession, delete("/api/v1/admin/users/" + editor.getId()).param("confirm", editor.getUsername()))
                .andExpect(status().is2xxSuccessful());

        assertThat(members.findByProjectIdAndUserId(fx.projectId(), editor.getId())).isEmpty();
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(fx.projectId())).hasSize((int) revisionsBefore + 1);
        // …while an ordinary removal stays refused.
        expectArchived(as(adminSession, delete("/api/v1/projects/" + fx.key() + "/members/" + fx.user().getId())));
    }

    @Test
    void theDomainGuardAppliesToServiceCallsToo() {
        projectService.archive(fx.key(), RevisionContext.of(fx.projectId(), admin.getId(), null));

        assertThatThrownBy(() -> projectService.setMemberRole(fx.key(), editor.getId(), ProjectRole.VIEWER, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(409);
                    assertThat(e.getProblem().getExtensions()).containsEntry("code", ARCHIVED);
                });
        assertThat(members.findByProjectIdAndUserId(fx.projectId(), editor.getId()).orElseThrow().getRole())
                .isEqualTo(ProjectRole.EDITOR);

        // A write that allocates no revision guards itself.
        assertThatThrownBy(() -> urlRegistry.reset(fx.projectId(), ResetScope.project(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getStatus()).isEqualTo(409));
    }
}
