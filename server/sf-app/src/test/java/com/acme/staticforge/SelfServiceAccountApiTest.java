package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditLogRepository;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.RefreshCookieService;
import com.acme.staticforge.security.RefreshTokenRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

/** Self-service account API (M26.1.3): profile, password rules, sign out everywhere. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SelfServiceAccountApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String PASSWORD = "secret-password";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired AppUserRepository users;
    @Autowired ProjectService projectService;
    @Autowired ProjectRepository projects;
    @Autowired RefreshTokenRepository refreshTokens;
    @Autowired AuditLogRepository auditLog;

    private record Session(String bearer, Cookie refreshCookie) {}

    private AppUser newUser(String prefix) {
        int n = SEQ.incrementAndGet();
        return userService.create(
                "ss-" + prefix + "-" + n, "ss-" + prefix + "-" + n + "@example.com", "Ss " + prefix + " " + n, PASSWORD);
    }

    private Session login(String username, String password) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("username", username, "password", password))))
                .andExpect(status().isOk())
                .andReturn();
        String token = objectMapper.readTree(result.getResponse().getContentAsString()).get("accessToken").asText();
        return new Session("Bearer " + token, result.getResponse().getCookie(RefreshCookieService.COOKIE_NAME));
    }

    private ResultActions patchMe(Session session, Map<String, Object> body) throws Exception {
        return mvc.perform(patch("/api/v1/auth/me")
                .header("Authorization", session.bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private static Map<String, Object> body(Object... keyValues) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            map.put((String) keyValues[i], keyValues[i + 1]);
        }
        return map;
    }

    private List<AuditLog> audit(Long userId, String action) {
        return auditLog.findAll().stream()
                .filter(e -> action.equals(e.getAction()) && userId.equals(e.getActorUserId()))
                .toList();
    }

    @Test
    void meReadsTheAccountWithEmailAndMembershipsButNoArchivedProjects() throws Exception {
        AppUser owner = newUser("owner");
        AppUser user = newUser("me");
        int n = SEQ.incrementAndGet();
        Project live = projectService.create(new CreateProjectRequest("ssme_live_" + n, "Live " + n, null, null), owner.getId());
        Project archived =
                projectService.create(new CreateProjectRequest("ssme_arch_" + n, "Archived " + n, null, null), owner.getId());
        for (Project p : List.of(live, archived)) {
            projectService.setMemberRole(
                    p.getKey(), user.getId(), ProjectRole.EDITOR, RevisionContext.of(p.getId(), owner.getId(), null));
        }
        Project stored = projects.findById(archived.getId()).orElseThrow();
        stored.setArchived(true);
        projects.save(stored);

        Session session = login(user.getUsername(), PASSWORD);
        mvc.perform(get("/api/v1/auth/me").header("Authorization", session.bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(user.getId()))
                .andExpect(jsonPath("$.username").value(user.getUsername()))
                .andExpect(jsonPath("$.email").value(user.getEmail()))
                .andExpect(jsonPath("$.mustChangePassword").value(false))
                .andExpect(jsonPath("$.memberships.length()").value(1))
                .andExpect(jsonPath("$.memberships[0].projectKey").value(live.getKey()))
                .andExpect(jsonPath("$.memberships[0].projectName").value(live.getName()))
                .andExpect(jsonPath("$.memberships[0].role").value("EDITOR"));

        AppUser admin = users.findById(owner.getId()).orElseThrow();
        admin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        users.save(admin);
        Session adminSession = login(owner.getUsername(), PASSWORD);
        mvc.perform(get("/api/v1/auth/me").header("Authorization", adminSession.bearer()))
                .andExpect(jsonPath("$.memberships.length()").value(2));
    }

    @Test
    void displayNameNeedsNoPasswordButUsernameAndEmailDo() throws Exception {
        AppUser user = newUser("profile");
        AppUser other = newUser("profile-other");
        Session session = login(user.getUsername(), PASSWORD);

        patchMe(session, body("displayName", "  Fresh Name "))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Fresh Name"));
        // Sending the unchanged username needs no password either.
        patchMe(session, body("username", user.getUsername(), "displayName", "Fresh Name")).andExpect(status().isOk());

        String renamed = user.getUsername() + "-new";
        patchMe(session, body("username", renamed))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("currentPassword"));
        patchMe(session, body("email", "x-" + user.getEmail()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("currentPassword"));
        patchMe(session, body("username", renamed, "currentPassword", "wrong-password"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("Current password is incorrect."))
                .andExpect(jsonPath("$.field").value("currentPassword"));
        patchMe(session, body("username", other.getUsername(), "currentPassword", PASSWORD))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.field").value("username"));
        patchMe(session, body("email", other.getEmail().toUpperCase(), "currentPassword", PASSWORD))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.field").value("email"));
        assertThat(users.findById(user.getId()).orElseThrow().getUsername()).isEqualTo(user.getUsername());

        patchMe(session, body("username", renamed, "email", "x-" + user.getEmail(), "currentPassword", PASSWORD))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(renamed))
                .andExpect(jsonPath("$.email").value("x-" + user.getEmail()));

        // The same session keeps working, and /auth/me shows the new name although the token claim is stale.
        mvc.perform(get("/api/v1/auth/me").header("Authorization", session.bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(renamed));
        assertThat(audit(user.getId(), "USER_RENAMED")).singleElement().satisfies(e -> {
            assertThat(e.getTarget()).isEqualTo("user:" + renamed);
            assertThat(e.getProjectId()).isNull();
        });
        assertThat(audit(user.getId(), "USER_UPDATED"))
                .extracting(e -> e.getDetail().get("fields").toString())
                .containsExactly("[\"displayName\"]", "[\"email\"]");
    }

    @Test
    void signOutEverywhereKillsEveryTokenIncludingTheCurrentOne() throws Exception {
        AppUser user = newUser("revoke");
        Session current = login(user.getUsername(), PASSWORD);
        Session elsewhere = login(user.getUsername(), PASSWORD);

        mvc.perform(post("/api/v1/auth/sessions/revoke")
                        .header("Authorization", current.bearer())
                        .cookie(current.refreshCookie()))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Set-Cookie", containsString("Max-Age=0")));

        for (Session session : List.of(current, elsewhere)) {
            mvc.perform(get("/api/v1/auth/me").header("Authorization", session.bearer()))
                    .andExpect(status().isUnauthorized());
            mvc.perform(post("/api/v1/auth/refresh")
                            .cookie(session.refreshCookie())
                            .header("X-Requested-With", "XMLHttpRequest"))
                    .andExpect(status().isUnauthorized());
        }
        assertThat(refreshTokens.findByUserId(user.getId())).isEmpty();
        assertThat(audit(user.getId(), "USER_SESSIONS_REVOKED")).hasSize(1);
        login(user.getUsername(), PASSWORD);
    }

    @Test
    void passwordPolicyIsPublicAndServesTheDefaults() throws Exception {
        mvc.perform(get("/api/v1/auth/password-policy"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.minLength").value(12))
                .andExpect(jsonPath("$.requireMixed").value(false))
                .andExpect(jsonPath("$.maxBytes").value(72));
    }

    @Test
    void passwordChangeEnforcesThePolicy() throws Exception {
        AppUser user = newUser("pwd");
        Session session = login(user.getUsername(), PASSWORD);

        mvc.perform(post("/api/v1/auth/password")
                        .header("Authorization", session.bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                body("currentPassword", PASSWORD, "newPassword", "x".repeat(73)))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SF-API-0400"))
                .andExpect(jsonPath("$.errors.length()").value(1))
                .andExpect(jsonPath("$.errors[0]").value(containsString("72 bytes")));
        // The refused change left the session and the password alone.
        mvc.perform(get("/api/v1/auth/me").header("Authorization", session.bearer())).andExpect(status().isOk());
        login(user.getUsername(), PASSWORD);
    }
}
