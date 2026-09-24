package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.audit.AuditLogRepository;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.RefreshCookieService;
import com.acme.staticforge.security.RefreshTokenRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * Account session rules of M26.1.1: the server-enforced forced password change ({@code 428 SF-API-0428} with its
 * exact allowlist), immediate revocation of a still-valid access token when a membership changes, refresh of a
 * disabled account, and the password policy on a self change.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AccountSessionRulesIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String PASSWORD = "secret-password";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired AppUserRepository users;
    @Autowired ProjectService projectService;
    @Autowired RefreshTokenRepository refreshTokens;
    @Autowired AuditLogRepository auditLog;

    private record Session(String accessToken, Cookie refreshCookie) {}

    private AppUser newUser(String prefix) {
        int n = SEQ.incrementAndGet();
        return userService.create(prefix + "-" + n, prefix + "-" + n + "@example.com", prefix + " " + n, PASSWORD);
    }

    private Project newProject(AppUser admin) {
        int n = SEQ.incrementAndGet();
        return projectService.create(new CreateProjectRequest("sessionrules_" + n, "Session Rules " + n, null, null),
                admin.getId());
    }

    private Session login(AppUser user, String password) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                java.util.Map.of("username", user.getUsername(), "password", password))))
                .andExpect(status().isOk())
                .andReturn();
        String token = objectMapper
                .readTree(result.getResponse().getContentAsString())
                .get("accessToken")
                .asText();
        return new Session(token, result.getResponse().getCookie(RefreshCookieService.COOKIE_NAME));
    }

    private Session refresh(Session session) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/refresh")
                        .cookie(session.refreshCookie())
                        .header("X-Requested-With", "XMLHttpRequest"))
                .andExpect(status().isOk())
                .andReturn();
        String token = objectMapper
                .readTree(result.getResponse().getContentAsString())
                .get("accessToken")
                .asText();
        return new Session(token, result.getResponse().getCookie(RefreshCookieService.COOKIE_NAME));
    }

    private static String bearer(Session session) {
        return "Bearer " + session.accessToken();
    }

    @Test
    void pendingPasswordChangeBlocksEverythingButTheAllowlist() throws Exception {
        AppUser admin = newUser("rules-admin");
        Project project = newProject(admin);
        AppUser newbie = newUser("rules-newbie");
        projectService.setMemberRole(
                project.getKey(), newbie.getId(), ProjectRole.EDITOR, RevisionContext.of(project.getId(), admin.getId(), null));
        AppUser stored = users.findById(newbie.getId()).orElseThrow();
        stored.setMustChangePassword(true);
        users.save(stored);

        Session session = login(newbie, PASSWORD);

        // Blocked: a project endpoint, and a profile edit (not on the allowlist, whether or not it exists yet).
        mvc.perform(get("/api/v1/projects/" + project.getKey()).header("Authorization", bearer(session)))
                .andExpect(status().is(428))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("SF-API-0428"))
                .andExpect(jsonPath("$.title").value("Password change required"));
        mvc.perform(patch("/api/v1/auth/me")
                        .header("Authorization", bearer(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"x\"}"))
                .andExpect(status().is(428));
        mvc.perform(get("/api/v1/projects").header("Authorization", bearer(session)))
                .andExpect(status().is(428));

        // Allowed: read the profile (which says why), the password rules, refresh.
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(session)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mustChangePassword").value(true));
        mvc.perform(get("/api/v1/auth/password-policy").header("Authorization", bearer(session)))
                .andExpect(status().isOk());
        session = refresh(session);
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(session)))
                .andExpect(status().isOk());

        // Allowed: the change itself — it applies the policy, then clears the flag.
        mvc.perform(post("/api/v1/auth/password")
                        .header("Authorization", bearer(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"" + PASSWORD + "\",\"newPassword\":\"short\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SF-API-0400"))
                .andExpect(jsonPath("$.errors[0]").value("Password must be at least 12 characters long."));
        mvc.perform(post("/api/v1/auth/password")
                        .header("Authorization", bearer(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"" + PASSWORD + "\",\"newPassword\":\"a-new-long-password\"}"))
                .andExpect(status().isNoContent());
        assertThat(users.findById(newbie.getId()).orElseThrow().isMustChangePassword()).isFalse();
        assertThat(auditLog.findAll())
                .anyMatch(entry -> "USER_PASSWORD_CHANGED".equals(entry.getAction())
                        && newbie.getId().equals(entry.getActorUserId())
                        && entry.getProjectId() == null
                        && ("user:" + newbie.getUsername()).equals(entry.getTarget()));

        // The change revoked the old session; a new sign-in reaches the project.
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(session)))
                .andExpect(status().isUnauthorized());
        Session fresh = login(newbie, "a-new-long-password");
        mvc.perform(get("/api/v1/projects/" + project.getKey()).header("Authorization", bearer(fresh)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(fresh)))
                .andExpect(jsonPath("$.mustChangePassword").value(false));
    }

    @Test
    void logoutIsAllowedWhileAPasswordChangeIsPending() throws Exception {
        AppUser newbie = newUser("rules-logout");
        AppUser stored = users.findById(newbie.getId()).orElseThrow();
        stored.setMustChangePassword(true);
        users.save(stored);
        Session session = login(newbie, PASSWORD);

        mvc.perform(post("/api/v1/auth/logout")
                        .header("Authorization", bearer(session))
                        .cookie(session.refreshCookie()))
                .andExpect(status().isNoContent());
        assertThat(refreshTokens.findByUserId(newbie.getId())).isEmpty();
    }

    @Test
    void roleDowngradeAppliesOnTheNextRequestOfAStillValidToken() throws Exception {
        AppUser admin = newUser("rules-owner");
        Project project = newProject(admin);
        AppUser member = newUser("rules-member");
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), null);
        projectService.setMemberRole(project.getKey(), member.getId(), ProjectRole.PROJECT_ADMIN, ctx);
        AppUser other = newUser("rules-other");

        Session session = login(member, PASSWORD);
        String membersUrl = "/api/v1/projects/" + project.getKey() + "/members/" + other.getId();
        mvc.perform(put(membersUrl)
                        .header("Authorization", bearer(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"VIEWER\"}"))
                .andExpect(status().isOk());

        Session adminSession = login(admin, PASSWORD);
        mvc.perform(put("/api/v1/projects/" + project.getKey() + "/members/" + member.getId())
                        .header("Authorization", bearer(adminSession))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"VIEWER\"}"))
                .andExpect(status().isOk());

        // The old token still claims PROJECT_ADMIN and has not expired, but its epoch is stale.
        mvc.perform(get("/api/v1/projects/" + project.getKey()).header("Authorization", bearer(session)))
                .andExpect(status().isUnauthorized());

        // A refresh issues a token with the new role: reads work, admin writes don't.
        Session refreshed = refresh(session);
        mvc.perform(get("/api/v1/projects/" + project.getKey()).header("Authorization", bearer(refreshed)))
                .andExpect(status().isOk());
        mvc.perform(put(membersUrl)
                        .header("Authorization", bearer(refreshed))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"EDITOR\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void removalAppliesOnTheNextRequestOfAStillValidToken() throws Exception {
        AppUser admin = newUser("rules-remover");
        Project project = newProject(admin);
        AppUser member = newUser("rules-removed");
        projectService.setMemberRole(
                project.getKey(), member.getId(), ProjectRole.EDITOR, RevisionContext.of(project.getId(), admin.getId(), null));

        Session session = login(member, PASSWORD);
        mvc.perform(get("/api/v1/projects/" + project.getKey()).header("Authorization", bearer(session)))
                .andExpect(status().isOk());

        Session adminSession = login(admin, PASSWORD);
        mvc.perform(delete("/api/v1/projects/" + project.getKey() + "/members/" + member.getId())
                        .header("Authorization", bearer(adminSession)))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/projects/" + project.getKey()).header("Authorization", bearer(session)))
                .andExpect(status().isUnauthorized());
        Session refreshed = refresh(session);
        mvc.perform(get("/api/v1/projects/" + project.getKey()).header("Authorization", bearer(refreshed)))
                .andExpect(status().isNotFound());
    }

    @Test
    void aProjectAdminRemovingThemselvesKeepsAWorkingSessionAfterRefresh() throws Exception {
        AppUser admin = newUser("rules-self");
        Project project = newProject(admin);

        Session session = login(admin, PASSWORD);
        mvc.perform(delete("/api/v1/projects/" + project.getKey() + "/members/" + admin.getId())
                        .header("Authorization", bearer(session)))
                .andExpect(status().isNoContent());

        // Their own token is revoked too; the client's refresh-on-401 gets a working token (no logout loop).
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(session)))
                .andExpect(status().isUnauthorized());
        Session refreshed = refresh(session);
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(refreshed)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectRoles." + project.getKey()).doesNotExist());
    }

    @Test
    void refreshOfADisabledAccountFailsAndDropsTheFamily() throws Exception {
        AppUser user = newUser("rules-disabled");
        Session session = login(user, PASSWORD);
        AppUser stored = users.findById(user.getId()).orElseThrow();
        stored.setStatus(UserStatus.DISABLED);
        users.save(stored);

        mvc.perform(post("/api/v1/auth/refresh")
                        .cookie(session.refreshCookie())
                        .header("X-Requested-With", "XMLHttpRequest"))
                .andExpect(status().isUnauthorized());

        assertThat(refreshTokens.findByUserId(user.getId())).isEmpty();
    }

    @Test
    void aDeletedAccountCannotSignInOrUseItsToken() throws Exception {
        AppUser user = newUser("rules-deleted");
        Session session = login(user, PASSWORD);
        AppUser stored = users.findById(user.getId()).orElseThrow();
        stored.setStatus(UserStatus.DELETED);
        users.save(stored);

        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(session)))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                java.util.Map.of("username", user.getUsername(), "password", PASSWORD))))
                .andExpect(status().isUnauthorized());
    }
}
