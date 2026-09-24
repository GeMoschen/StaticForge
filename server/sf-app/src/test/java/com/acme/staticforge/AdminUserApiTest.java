package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditLogRepository;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectMemberRepository;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.security.RefreshTokenRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** Instance-admin user API, member lookup and private member emails (M26.1.2). */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AdminUserApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String PASSWORD = "secret-password";
    private static final String BASE = "/api/v1/admin/users";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired AppUserRepository users;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired ProjectMemberRepository members;
    @Autowired RevisionRepository revisions;
    @Autowired AuditLogRepository auditLog;
    @Autowired RefreshTokenRepository refreshTokens;

    // ---------------------------------------------------------------- fixtures

    private static int next() {
        return SEQ.incrementAndGet();
    }

    private AppUser newUser(String prefix) {
        int n = next();
        return userService.create(
                "au-" + prefix + "-" + n, "au-" + prefix + "-" + n + "@example.com", "Au " + prefix + " " + n, PASSWORD);
    }

    private AppUser newAdmin() {
        AppUser admin = newUser("admin");
        admin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        return users.save(admin);
    }

    private Project newProject(AppUser owner) {
        int n = next();
        return projectService.create(
                new CreateProjectRequest("adminusers_" + n, "Admin Users " + n, null, null), owner.getId());
    }

    private void grant(Project project, AppUser user, ProjectRole role, AppUser by) {
        projectService.setMemberRole(
                project.getKey(), user.getId(), role, RevisionContext.of(project.getId(), by.getId(), null));
    }

    private String token(AppUser user) {
        return "Bearer " + jwtService.issueAccessToken(user);
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, AppUser as) throws Exception {
        return mvc.perform(request.header("Authorization", token(as)));
    }

    private ResultActions send(MockHttpServletRequestBuilder request, AppUser as, Object body) throws Exception {
        return mvc.perform(request.header("Authorization", token(as))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private MvcResult login(String username, String password) throws Exception {
        return mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("username", username, "password", password))))
                .andReturn();
    }

    private String bearerFrom(MvcResult login) throws Exception {
        return "Bearer " + objectMapper.readTree(login.getResponse().getContentAsString()).get("accessToken").asText();
    }

    private List<AuditLog> auditAbout(Long userId, String action) {
        return auditLog.findAll().stream()
                .filter(e -> action.equals(e.getAction()))
                .filter(e -> e.getDetail() != null && e.getDetail().path("userId").asLong() == userId)
                .toList();
    }

    private static Map<String, Object> body(Object... keyValues) {
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            map.put((String) keyValues[i], keyValues[i + 1]);
        }
        return map;
    }

    // ---------------------------------------------------------------- access

    @Test
    void everyAdminEndpointIsForbiddenToANonAdmin() throws Exception {
        AppUser plain = newUser("plain");
        AppUser other = newUser("other");
        String one = BASE + "/" + other.getId();

        perform(get(BASE), plain).andExpect(status().isForbidden());
        perform(get(one), plain).andExpect(status().isForbidden());
        send(post(BASE), plain, body("username", "x", "email", "x@example.com", "generatePassword", true))
                .andExpect(status().isForbidden());
        send(patch(one), plain, body("displayName", "x")).andExpect(status().isForbidden());
        perform(post(one + "/disable"), plain).andExpect(status().isForbidden());
        perform(post(one + "/enable"), plain).andExpect(status().isForbidden());
        perform(post(one + "/unlock"), plain).andExpect(status().isForbidden());
        perform(post(one + "/revoke-sessions"), plain).andExpect(status().isForbidden());
        send(post(one + "/password"), plain, body("generatePassword", true)).andExpect(status().isForbidden());
        send(put(one + "/system-role"), plain, body("systemRole", "INSTANCE_ADMIN")).andExpect(status().isForbidden());
        perform(delete(one + "?confirm=" + other.getUsername()), plain).andExpect(status().isForbidden());

        AppUser unchanged = users.findById(other.getId()).orElseThrow();
        assertThat(unchanged.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(unchanged.getSystemRole()).isEqualTo(SystemRole.USER);
    }

    // ---------------------------------------------------------------- list + detail

    @Test
    void listFiltersPagesSortsAndCountsProjects() throws Exception {
        AppUser admin = newAdmin();
        int n = next();
        String tag = "listtag" + n;
        AppUser a = userService.create(tag + "-a", tag + "-a@example.com", "Alpha", PASSWORD);
        AppUser b = userService.create("beta-" + n, "beta-" + n + "@example.com", "Beta " + tag.toUpperCase(), PASSWORD);
        AppUser c = userService.create("gamma-" + n, "gamma-" + n + "@" + tag + ".example", null, PASSWORD);
        grant(newProject(admin), a, ProjectRole.EDITOR, admin);
        grant(newProject(admin), a, ProjectRole.VIEWER, admin);

        // q matches username, display name and email, ignoring case; default sort is username ascending.
        JsonNode first = json(perform(get(BASE + "?q=" + tag.toUpperCase() + "&size=2"), admin)
                .andExpect(status().isOk()));
        assertThat(first.at("/page/totalElements").asLong()).isEqualTo(3);
        assertThat(first.at("/page/totalPages").asInt()).isEqualTo(2);
        assertThat(first.at("/page/number").asInt()).isZero();
        List<String> names = new ArrayList<>();
        first.get("content").forEach(row -> names.add(row.get("username").asText()));
        assertThat(names).containsExactly(b.getUsername(), c.getUsername());
        JsonNode second = json(perform(get(BASE + "?q=" + tag + "&size=2&page=1"), admin));
        assertThat(second.at("/content/0/username").asText()).isEqualTo(a.getUsername());
        assertThat(second.at("/content/0/projectCount").asLong()).isEqualTo(2);
        assertThat(second.at("/content/0/email").asText()).isEqualTo(a.getEmail());
        assertThat(second.at("/content/0/mustChangePassword").asBoolean()).isFalse();

        JsonNode descending = json(perform(get(BASE + "?q=" + tag + "&sort=username,desc"), admin));
        assertThat(descending.at("/content/0/username").asText()).isEqualTo(a.getUsername());

        // status and systemRole filters
        AppUser disabled = users.findById(c.getId()).orElseThrow();
        disabled.setStatus(UserStatus.DISABLED);
        users.save(disabled);
        JsonNode onlyDisabled = json(perform(get(BASE + "?q=" + tag + "&status=DISABLED"), admin));
        assertThat(onlyDisabled.at("/page/totalElements").asLong()).isEqualTo(1);
        assertThat(onlyDisabled.at("/content/0/status").asText()).isEqualTo("DISABLED");
        JsonNode admins = json(perform(get(BASE + "?q=" + tag + "&systemRole=INSTANCE_ADMIN"), admin));
        assertThat(admins.at("/page/totalElements").asLong()).isZero();
        users.save(withRole(b, SystemRole.INSTANCE_ADMIN));
        admins = json(perform(get(BASE + "?q=" + tag + "&systemRole=INSTANCE_ADMIN"), admin));
        assertThat(admins.at("/page/totalElements").asLong()).isEqualTo(1);
        assertThat(admins.at("/content/0/systemRole").asText()).isEqualTo("INSTANCE_ADMIN");

        perform(get(BASE + "?sort=passwordHash"), admin)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("sort"));
        perform(get(BASE + "?status=SLEEPING"), admin).andExpect(status().isBadRequest());
        perform(get(BASE + "?size=500"), admin).andExpect(status().isBadRequest());
        perform(get(BASE + "?sort=status,desc&sort=username"), admin).andExpect(status().isOk());
    }

    @Test
    void detailCarriesMembershipsAndLockState() throws Exception {
        AppUser admin = newAdmin();
        AppUser user = newUser("detail");
        Project project = newProject(admin);
        grant(project, user, ProjectRole.DEVELOPER, admin);

        perform(get(BASE + "/" + user.getId()), admin)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(user.getUsername()))
                .andExpect(jsonPath("$.email").value(user.getEmail()))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.systemRole").value("USER"))
                .andExpect(jsonPath("$.failedLogins").value(0))
                .andExpect(jsonPath("$.createdAt").exists())
                .andExpect(jsonPath("$.projectCount").value(1))
                .andExpect(jsonPath("$.memberships[0].projectKey").value(project.getKey()))
                .andExpect(jsonPath("$.memberships[0].projectName").value(project.getName()))
                .andExpect(jsonPath("$.memberships[0].archived").value(false))
                .andExpect(jsonPath("$.memberships[0].role").value("DEVELOPER"))
                .andExpect(jsonPath("$.memberships[0].grantedBy").value(admin.getUsername()))
                .andExpect(jsonPath("$.generatedPassword").doesNotExist());
        perform(get(BASE + "/999999999"), admin).andExpect(status().isNotFound());
    }

    // ---------------------------------------------------------------- create

    @Test
    void createWithGeneratedPasswordReturnsItOnceAndForcesAChange() throws Exception {
        AppUser admin = newAdmin();
        int n = next();
        String username = "gen-" + n;

        JsonNode created = json(send(post(BASE), admin, body(
                        "username", "  " + username + "  ",
                        "email", "gen-" + n + "@example.com",
                        "displayName", "Generated " + n,
                        "generatePassword", true))
                .andExpect(status().isCreated()));
        long id = created.get("id").asLong();
        String generated = created.get("generatedPassword").asText();
        assertThat(created.get("username").asText()).isEqualTo(username);
        assertThat(created.get("systemRole").asText()).isEqualTo("USER");
        assertThat(created.get("mustChangePassword").asBoolean()).isTrue();
        assertThat(generated).hasSize(16);

        perform(get(BASE + "/" + id), admin).andExpect(jsonPath("$.generatedPassword").doesNotExist());

        MvcResult login = login(username, generated);
        assertThat(login.getResponse().getStatus()).isEqualTo(200);
        mvc.perform(get("/api/v1/projects").header("Authorization", bearerFrom(login)))
                .andExpect(status().is(428));

        assertThat(auditAbout(id, "USER_CREATED"))
                .singleElement()
                .satisfies(e -> {
                    assertThat(e.getActorUserId()).isEqualTo(admin.getId());
                    assertThat(e.getProjectId()).isNull();
                    assertThat(e.getTarget()).isEqualTo("user:" + username);
                    assertThat(e.getDetail().get("generatedPassword").asBoolean()).isTrue();
                    assertThat(e.getDetail().toString()).doesNotContain(generated);
                });
    }

    @Test
    void createWithTypedPasswordAndMembershipsGrantsEachRoleInOneRevision() throws Exception {
        AppUser admin = newAdmin();
        Project first = newProject(admin);
        Project second = newProject(admin);
        long firstRevisions = revisions.findByProjectIdOrderByRevisionIdDesc(first.getId()).size();
        long secondRevisions = revisions.findByProjectIdOrderByRevisionIdDesc(second.getId()).size();
        int n = next();

        JsonNode created = json(send(post(BASE), admin, body(
                        "username", "typed-" + n,
                        "email", "typed-" + n + "@example.com",
                        "systemRole", "USER",
                        "password", "a-typed-password",
                        "mustChangePassword", false,
                        "memberships", List.of(
                                body("projectKey", first.getKey(), "role", "EDITOR"),
                                body("projectKey", second.getKey(), "role", "viewer"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.generatedPassword").doesNotExist())
                .andExpect(jsonPath("$.mustChangePassword").value(false))
                .andExpect(jsonPath("$.projectCount").value(2)));
        long id = created.get("id").asLong();

        assertThat(members.findByProjectIdAndUserId(first.getId(), id).orElseThrow().getRole())
                .isEqualTo(ProjectRole.EDITOR);
        assertThat(members.findByProjectIdAndUserId(second.getId(), id).orElseThrow().getRole())
                .isEqualTo(ProjectRole.VIEWER);
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(first.getId())).hasSize((int) firstRevisions + 1);
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(second.getId())).hasSize((int) secondRevisions + 1);
        assertThat(auditLog.findAll())
                .filteredOn(e -> "MEMBER_ROLE_SET".equals(e.getAction()) && ("member:" + id).equals(e.getTarget()))
                .hasSize(2);

        MvcResult login = login("typed-" + n, "a-typed-password");
        mvc.perform(get("/api/v1/projects/" + first.getKey()).header("Authorization", bearerFrom(login)))
                .andExpect(status().isOk());
    }

    @Test
    void createValidatesPasswordIdentityAndRoles() throws Exception {
        AppUser admin = newAdmin();
        AppUser existing = newUser("taken");
        int n = next();

        send(post(BASE), admin, body("username", "short-" + n, "email", "short-" + n + "@example.com", "password", "short"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SF-API-0400"))
                .andExpect(jsonPath("$.errors[0]").value("Password must be at least 12 characters long."));
        send(post(BASE), admin, body("username", "none-" + n, "email", "none-" + n + "@example.com"))
                .andExpect(status().isBadRequest());
        send(post(BASE), admin, body("username", "both-" + n, "email", "both-" + n + "@example.com",
                        "password", "long-enough-password", "generatePassword", true))
                .andExpect(status().isBadRequest());
        send(post(BASE), admin, body("username", existing.getUsername().toUpperCase(), "email", "dup-" + n + "@example.com",
                        "generatePassword", true))
                .andExpect(status().isConflict());
        send(post(BASE), admin, body("username", "dupmail-" + n, "email", existing.getEmail().toUpperCase(),
                        "generatePassword", true))
                .andExpect(status().isConflict());
        send(post(BASE), admin, body("username", "has space", "email", "space-" + n + "@example.com",
                        "generatePassword", true))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("username"));
        send(post(BASE), admin, body("username", "deleted-user-" + n, "email", "reserved-" + n + "@example.com",
                        "generatePassword", true))
                .andExpect(status().isBadRequest());
        send(post(BASE), admin, body("username", "badmail-" + n, "email", "not-an-address", "generatePassword", true))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("email"));
        send(post(BASE), admin, body("username", "role-" + n, "email", "role-" + n + "@example.com",
                        "systemRole", "SUPERUSER", "generatePassword", true))
                .andExpect(status().isBadRequest());
        send(post(BASE), admin, body("username", "prole-" + n, "email", "prole-" + n + "@example.com",
                        "generatePassword", true, "memberships", List.of(body("projectKey", "nope", "role", "OWNER"))))
                .andExpect(status().isBadRequest());
        // An unknown project rolls the whole creation back.
        send(post(BASE), admin, body("username", "noproj-" + n, "email", "noproj-" + n + "@example.com",
                        "generatePassword", true, "memberships", List.of(body("projectKey", "no_such_" + n, "role", "EDITOR"))))
                .andExpect(status().isNotFound());
        assertThat(users.findByUsername("noproj-" + n)).isEmpty();
    }

    // ---------------------------------------------------------------- edit

    @Test
    void editRenamesAndUpdatesWithAudit() throws Exception {
        AppUser admin = newAdmin();
        AppUser user = newUser("edit");
        AppUser other = newUser("edit-other");
        String oldName = user.getUsername();
        String newName = oldName + "-renamed";
        String session = token(user);

        send(patch(BASE + "/" + user.getId()), admin, body("username", newName, "displayName", "  New Name  "))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(newName))
                .andExpect(jsonPath("$.displayName").value("New Name"))
                .andExpect(jsonPath("$.email").value(user.getEmail()));
        send(patch(BASE + "/" + user.getId()), admin, body("email", other.getEmail())).andExpect(status().isConflict());
        send(patch(BASE + "/" + user.getId()), admin, body("username", other.getUsername()))
                .andExpect(status().isConflict());
        send(patch(BASE + "/" + user.getId()), admin, body("displayName", "")).andExpect(jsonPath("$.displayName").isEmpty());

        assertThat(auditAbout(user.getId(), "USER_RENAMED")).singleElement().satisfies(e -> {
            assertThat(e.getTarget()).isEqualTo("user:" + newName);
            assertThat(e.getDetail().get("from").asText()).isEqualTo(oldName);
            assertThat(e.getDetail().get("to").asText()).isEqualTo(newName);
        });
        assertThat(auditAbout(user.getId(), "USER_UPDATED"))
                .extracting(e -> e.getDetail().get("fields").toString())
                .containsExactly("[\"displayName\"]", "[\"displayName\"]");

        // A rename keeps sessions: the token names the account by id.
        mvc.perform(get("/api/v1/auth/me").header("Authorization", session)).andExpect(status().isOk());
        assertThat(login(newName, PASSWORD).getResponse().getStatus()).isEqualTo(200);
        assertThat(login(oldName, PASSWORD).getResponse().getStatus()).isEqualTo(401);
    }

    // ---------------------------------------------------------------- actions

    @Test
    void disableRevokesImmediatelyKeepsMembershipsAndEnableRestores() throws Exception {
        AppUser admin = newAdmin();
        AppUser user = newUser("disable");
        Project project = newProject(admin);
        grant(project, user, ProjectRole.EDITOR, admin);
        MvcResult session = login(user.getUsername(), PASSWORD);
        String bearer = bearerFrom(session);

        perform(post(BASE + "/" + user.getId() + "/disable"), admin)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DISABLED"))
                .andExpect(jsonPath("$.projectCount").value(1));
        mvc.perform(get("/api/v1/projects/" + project.getKey()).header("Authorization", bearer))
                .andExpect(status().isUnauthorized());
        assertThat(refreshTokens.findByUserId(user.getId())).isEmpty();
        assertThat(login(user.getUsername(), PASSWORD).getResponse().getStatus()).isEqualTo(401);

        // Disabled accounts can't be added to another project.
        Project other = newProject(admin);
        send(put("/api/v1/projects/" + other.getKey() + "/members/" + user.getId()), admin, body("role", "VIEWER"))
                .andExpect(status().isConflict());

        perform(post(BASE + "/" + user.getId() + "/enable"), admin)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        MvcResult again = login(user.getUsername(), PASSWORD);
        mvc.perform(get("/api/v1/projects/" + project.getKey()).header("Authorization", bearerFrom(again)))
                .andExpect(status().isOk());
        assertThat(auditAbout(user.getId(), "USER_DISABLED")).hasSize(1);
        assertThat(auditAbout(user.getId(), "USER_ENABLED")).hasSize(1);
    }

    @Test
    void unlockClearsTheLockout() throws Exception {
        AppUser admin = newAdmin();
        AppUser user = newUser("locked");
        AppUser stored = users.findById(user.getId()).orElseThrow();
        stored.setStatus(UserStatus.LOCKED);
        stored.setFailedLogins(15);
        stored.setLockedUntil(Instant.now().plusSeconds(1800));
        users.save(stored);
        assertThat(login(user.getUsername(), PASSWORD).getResponse().getStatus()).isEqualTo(423);

        perform(post(BASE + "/" + user.getId() + "/unlock"), admin)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.failedLogins").value(0))
                .andExpect(jsonPath("$.lockedUntil").isEmpty());
        assertThat(login(user.getUsername(), PASSWORD).getResponse().getStatus()).isEqualTo(200);
        assertThat(auditAbout(user.getId(), "USER_UNLOCKED")).hasSize(1);
    }

    @Test
    void resetPasswordRevokesSessionsAndForcesAChange() throws Exception {
        AppUser admin = newAdmin();
        AppUser user = newUser("reset");
        MvcResult session = login(user.getUsername(), PASSWORD);

        send(post(BASE + "/" + user.getId() + "/password"), admin, body("password", "short"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors").isArray());
        JsonNode reset = json(send(post(BASE + "/" + user.getId() + "/password"), admin, body("generatePassword", true))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mustChangePassword").value(true)));
        String generated = reset.get("generatedPassword").asText();

        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearerFrom(session)))
                .andExpect(status().isUnauthorized());
        assertThat(refreshTokens.findByUserId(user.getId())).isEmpty();
        assertThat(login(user.getUsername(), PASSWORD).getResponse().getStatus()).isEqualTo(401);
        MvcResult fresh = login(user.getUsername(), generated);
        mvc.perform(get("/api/v1/projects").header("Authorization", bearerFrom(fresh))).andExpect(status().is(428));

        send(post(BASE + "/" + user.getId() + "/password"), admin,
                        body("password", "an-admin-chosen-one", "mustChangePassword", false))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generatedPassword").doesNotExist())
                .andExpect(jsonPath("$.mustChangePassword").value(false));
        MvcResult chosen = login(user.getUsername(), "an-admin-chosen-one");
        mvc.perform(get("/api/v1/projects").header("Authorization", bearerFrom(chosen))).andExpect(status().isOk());
        assertThat(auditAbout(user.getId(), "USER_PASSWORD_RESET")).hasSize(2);
    }

    @Test
    void revokeSessionsSignsTheAccountOutEverywhere() throws Exception {
        AppUser admin = newAdmin();
        AppUser user = newUser("revoke");
        MvcResult session = login(user.getUsername(), PASSWORD);

        perform(post(BASE + "/" + user.getId() + "/revoke-sessions"), admin).andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearerFrom(session)))
                .andExpect(status().isUnauthorized());
        assertThat(refreshTokens.findByUserId(user.getId())).isEmpty();
        assertThat(login(user.getUsername(), PASSWORD).getResponse().getStatus()).isEqualTo(200);
        assertThat(auditAbout(user.getId(), "USER_SESSIONS_REVOKED")).hasSize(1);
    }

    @Test
    void systemRoleGrantAndRevokeApplyOnTheNextRequest() throws Exception {
        AppUser admin = newAdmin();
        AppUser user = newUser("promote");
        String before = token(user);

        send(put(BASE + "/" + user.getId() + "/system-role"), admin, body("systemRole", "INSTANCE_ADMIN"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.systemRole").value("INSTANCE_ADMIN"));
        mvc.perform(get(BASE).header("Authorization", before)).andExpect(status().isUnauthorized());
        String promoted = token(user);
        mvc.perform(get(BASE).header("Authorization", promoted)).andExpect(status().isOk());

        send(put(BASE + "/" + user.getId() + "/system-role"), admin, body("systemRole", "USER"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.systemRole").value("USER"));
        // The token that still claims INSTANCE_ADMIN is dead.
        mvc.perform(get(BASE).header("Authorization", promoted)).andExpect(status().isUnauthorized());
        perform(get(BASE), user).andExpect(status().isForbidden());
        assertThat(auditAbout(user.getId(), "USER_SYSTEM_ROLE_SET"))
                .extracting(e -> e.getDetail().get("systemRole").asText())
                .containsExactly("INSTANCE_ADMIN", "USER");
        send(put(BASE + "/" + user.getId() + "/system-role"), admin, body("systemRole", "ROOT"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void anAdminCantDisableDeleteOrDemoteThemselvesButAnotherAdminCan() throws Exception {
        AppUser admin = newAdmin();
        AppUser second = newAdmin();

        perform(post(BASE + "/" + admin.getId() + "/disable"), admin)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0132"));
        perform(delete(BASE + "/" + admin.getId() + "?confirm=" + admin.getUsername()), admin)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0132"));
        send(put(BASE + "/" + admin.getId() + "/system-role"), admin, body("systemRole", "USER"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0132"));

        send(put(BASE + "/" + admin.getId() + "/system-role"), second, body("systemRole", "USER"))
                .andExpect(status().isOk());
        perform(post(BASE + "/" + admin.getId() + "/disable"), second).andExpect(status().isOk());
    }

    // ---------------------------------------------------------------- delete

    @Test
    void deleteAnonymizesTheAccountAndItsAuditTrail() throws Exception {
        AppUser admin = newAdmin();
        AppUser user = newUser("gone");
        Project first = newProject(admin);
        Project second = newProject(admin);
        grant(first, user, ProjectRole.EDITOR, admin);
        grant(second, user, ProjectRole.VIEWER, admin);
        long firstRevisions = revisions.findByProjectIdOrderByRevisionIdDesc(first.getId()).size();
        MvcResult session = login(user.getUsername(), PASSWORD);
        String renamed = user.getUsername() + "-x";
        send(patch(BASE + "/" + user.getId()), admin, body("username", renamed)).andExpect(status().isOk());
        String email = user.getEmail();

        perform(delete(BASE + "/" + user.getId() + "?confirm=" + user.getUsername()), admin)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("confirm"));
        perform(delete(BASE + "/" + user.getId()), admin).andExpect(status().isBadRequest());

        perform(delete(BASE + "/" + user.getId() + "?confirm=" + renamed), admin).andExpect(status().isNoContent());

        long id = user.getId();
        AppUser deleted = users.findById(id).orElseThrow();
        assertThat(deleted.getUsername()).isEqualTo("deleted-user-" + id);
        assertThat(deleted.getEmail()).isEqualTo("deleted-" + id + "@invalid");
        assertThat(deleted.getDisplayName()).isEqualTo("Deleted user");
        assertThat(deleted.getPasswordHash()).isNull();
        assertThat(deleted.getStatus()).isEqualTo(UserStatus.DELETED);
        assertThat(deleted.getFailedLogins()).isZero();
        assertThat(deleted.getLockedUntil()).isNull();
        assertThat(deleted.isMustChangePassword()).isFalse();
        assertThat(members.findByUserId(id)).isEmpty();
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(first.getId())).hasSize((int) firstRevisions + 1);
        assertThat(refreshTokens.findByUserId(id)).isEmpty();

        // Old token and old names are dead.
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearerFrom(session)))
                .andExpect(status().isUnauthorized());
        assertThat(login(renamed, PASSWORD).getResponse().getStatus()).isEqualTo(401);

        // No audit entry about the account still names it: its own login, the admin's rename and delete.
        List<AuditLog> about = auditLog.findAll().stream()
                .filter(e -> Long.valueOf(id).equals(e.getActorUserId())
                        || (e.getDetail() != null && e.getDetail().path("userId").asLong() == id))
                .toList();
        assertThat(about).extracting(AuditLog::getAction).contains("AUTH_LOGIN", "USER_RENAMED", "USER_DELETED");
        assertThat(about)
                .filteredOn(e -> e.getTarget() != null && e.getTarget().startsWith("user:"))
                .allSatisfy(e -> assertThat(e.getTarget()).isEqualTo("user:deleted-user-" + id));
        assertThat(about).allSatisfy(e -> {
            String text = e.getTarget() + " " + e.getDetail();
            assertThat(text).doesNotContain(user.getUsername()).doesNotContain(email);
        });
        assertThat(auditAbout(id, "USER_RENAMED")).singleElement().satisfies(e -> {
            assertThat(e.getDetail().get("from").asText()).isEqualTo("deleted-user-" + id);
            assertThat(e.getActorUserId()).isEqualTo(admin.getId());
        });

        // Hidden from the listing unless asked for; nothing applies to it any more.
        JsonNode hidden = json(perform(get(BASE + "?q=deleted-user-" + id), admin));
        assertThat(hidden.at("/page/totalElements").asLong()).isZero();
        JsonNode shown = json(perform(get(BASE + "?q=deleted-user-" + id + "&includeDeleted=true"), admin));
        assertThat(shown.at("/content/0/status").asText()).isEqualTo("DELETED");
        perform(get(BASE + "/" + id), admin).andExpect(status().isOk()).andExpect(jsonPath("$.displayName").value("Deleted user"));
        perform(post(BASE + "/" + id + "/enable"), admin).andExpect(status().isConflict());
        send(patch(BASE + "/" + id), admin, body("displayName", "Back")).andExpect(status().isConflict());
        perform(delete(BASE + "/" + id + "?confirm=deleted-user-" + id), admin).andExpect(status().isConflict());
        send(put("/api/v1/projects/" + first.getKey() + "/members/" + id), admin, body("role", "VIEWER"))
                .andExpect(status().isConflict());
    }

    // ---------------------------------------------------------------- still-valid tokens

    @Test
    void aStillValidTokenOfADisabledDeletedResetOrDemotedAccountIsRejected() throws Exception {
        AppUser admin = newAdmin();
        AppUser disabled = newUser("tok-disabled");
        AppUser deleted = newUser("tok-deleted");
        AppUser reset = newUser("tok-reset");
        AppUser demoted = newAdmin();
        Map<AppUser, String> tokens = new java.util.LinkedHashMap<>();
        for (AppUser u : List.of(disabled, deleted, reset, demoted)) {
            tokens.put(u, token(u));
            mvc.perform(get("/api/v1/auth/me").header("Authorization", tokens.get(u))).andExpect(status().isOk());
        }

        perform(post(BASE + "/" + disabled.getId() + "/disable"), admin).andExpect(status().isOk());
        perform(delete(BASE + "/" + deleted.getId() + "?confirm=" + deleted.getUsername()), admin)
                .andExpect(status().isNoContent());
        send(post(BASE + "/" + reset.getId() + "/password"), admin, body("generatePassword", true))
                .andExpect(status().isOk());
        send(put(BASE + "/" + demoted.getId() + "/system-role"), admin, body("systemRole", "USER"))
                .andExpect(status().isOk());

        for (String bearer : tokens.values()) {
            mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer)).andExpect(status().isUnauthorized());
        }
    }

    // ---------------------------------------------------------------- lookup

    @Test
    void lookupServesProjectAdminsWithoutEmails() throws Exception {
        AppUser admin = newAdmin();
        Project project = newProject(admin);
        AppUser projectAdmin = newUser("lk-padmin");
        AppUser editor = newUser("lk-editor");
        AppUser outsider = newUser("lk-outsider");
        grant(project, projectAdmin, ProjectRole.PROJECT_ADMIN, admin);
        grant(project, editor, ProjectRole.EDITOR, admin);
        int n = next();
        String tag = "lookup" + n;
        AppUser member = userService.create(tag + "-member", tag + "-member@example.com", "Member", PASSWORD);
        AppUser candidate = userService.create(tag + "-candidate", tag + "-cand@example.com", "Candidate", PASSWORD);
        AppUser locked = userService.create(tag + "-locked", tag + "-locked@example.com", null, PASSWORD);
        AppUser disabled = userService.create(tag + "-disabled", tag + "-disabled@example.com", null, PASSWORD);
        AppUser byName = userService.create("zz-" + n, "zz-" + n + "@example.com", "Shown As " + tag, PASSWORD);
        userService.create("mail-only-" + n, tag + "-mailonly@example.com", null, PASSWORD);
        grant(project, member, ProjectRole.VIEWER, admin);
        setStatus(locked, UserStatus.LOCKED);
        setStatus(disabled, UserStatus.DISABLED);
        String url = "/api/v1/users/lookup?projectKey=" + project.getKey() + "&q=" + tag.toUpperCase();

        JsonNode hits = json(perform(get(url), projectAdmin).andExpect(status().isOk()));
        List<String> names = new ArrayList<>();
        hits.forEach(h -> names.add(h.get("username").asText()));
        assertThat(names).containsExactly(
                candidate.getUsername(), locked.getUsername(), member.getUsername(), byName.getUsername());
        hits.forEach(h -> assertThat(h.has("email")).isFalse());
        assertThat(hits.get(2).get("member").asBoolean()).isTrue();
        assertThat(hits.get(0).get("member").asBoolean()).isFalse();
        assertThat(hits.get(0).get("id").asLong()).isEqualTo(candidate.getId());

        perform(get(url), admin).andExpect(status().isOk());
        perform(get(url), editor).andExpect(status().isForbidden());
        perform(get(url), outsider).andExpect(status().isNotFound());
        JsonNode capped = json(perform(get("/api/v1/users/lookup?projectKey=" + project.getKey()), projectAdmin));
        assertThat(capped.size()).isLessThanOrEqualTo(20);
    }

    private AppUser withRole(AppUser user, SystemRole role) {
        AppUser stored = users.findById(user.getId()).orElseThrow();
        stored.setSystemRole(role);
        return stored;
    }

    private void setStatus(AppUser user, UserStatus status) {
        AppUser stored = users.findById(user.getId()).orElseThrow();
        stored.setStatus(status);
        users.save(stored);
    }

    // ---------------------------------------------------------------- member emails

    @Test
    void memberEmailsAreOnlyShownToProjectAndInstanceAdmins() throws Exception {
        AppUser admin = newAdmin();
        Project project = newProject(admin);
        Map<ProjectRole, AppUser> byRole = new java.util.EnumMap<>(ProjectRole.class);
        for (ProjectRole role : ProjectRole.values()) {
            AppUser user = newUser("em-" + role.name().toLowerCase());
            grant(project, user, role, admin);
            byRole.put(role, user);
        }
        AppUser disabled = byRole.get(ProjectRole.VIEWER);
        String url = "/api/v1/projects/" + project.getKey() + "/members";

        for (ProjectRole role : List.of(ProjectRole.VIEWER, ProjectRole.EDITOR, ProjectRole.DEVELOPER)) {
            JsonNode list = json(perform(get(url), byRole.get(role)).andExpect(status().isOk()));
            list.forEach(m -> assertThat(m.get("email").isNull()).as(role + " sees no email").isTrue());
        }
        for (AppUser viewer : List.of(byRole.get(ProjectRole.PROJECT_ADMIN), admin)) {
            JsonNode list = json(perform(get(url), viewer).andExpect(status().isOk()));
            list.forEach(m -> assertThat(m.get("email").asText()).contains("@"));
        }

        setStatus(disabled, UserStatus.DISABLED);
        JsonNode list = json(perform(get(url), admin));
        List<String> statuses = new ArrayList<>();
        list.forEach(m -> {
            if (m.get("userId").asLong() == disabled.getId()) {
                statuses.add(m.get("status").asText());
            }
        });
        assertThat(statuses).containsExactly("DISABLED");
    }
}
