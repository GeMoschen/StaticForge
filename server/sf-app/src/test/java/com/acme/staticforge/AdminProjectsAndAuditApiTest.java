package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditLogRepository;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserAdministrationService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Admin projects overview and the instance audit trail (M26.3.1). The test database is shared with other test
 * classes, so every audit assertion narrows to entries of this test's own actor or projects.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AdminProjectsAndAuditApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired AppUserRepository users;
    @Autowired UserAdministrationService administration;
    @Autowired ProjectService projectService;
    @Autowired RevisionRepository revisions;
    @Autowired AuditLogRepository auditLog;
    @Autowired JwtService jwtService;

    private AppUser admin;
    private AppUser actor;
    private Project project;
    /** A fixed base in the past so date filters don't collide with entries other tests write "now". */
    private Instant base;

    @BeforeEach
    void setUp() {
        admin = newUser("aud-admin");
        admin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        admin = users.save(admin);
        actor = newUser("aud-actor");
        project = newProject("audit");
        base = Instant.parse("2020-01-01T00:00:00Z").plus(SEQ.incrementAndGet(), ChronoUnit.DAYS);
    }

    // ---------------------------------------------------------------- fixtures

    private AppUser newUser(String prefix) {
        int n = SEQ.incrementAndGet();
        return userService.create(prefix + "-" + n, prefix + "-" + n + "@example.com", prefix + " " + n, "secret-password");
    }

    private Project newProject(String prefix) {
        int n = SEQ.incrementAndGet();
        return projectService.create(
                new CreateProjectRequest("adm" + prefix + "_" + n, "Admin " + prefix + " #" + n + "#", "desc #" + n + "#", null),
                admin.getId());
    }

    /** An entry of {@link #actor} at {@code base + minutes}. */
    private AuditLog entry(Long projectId, String action, int minutes) {
        return auditLog.save(new AuditLog(
                projectId, actor.getId(), action, "t:" + action, null, base.plus(minutes, ChronoUnit.MINUTES)));
    }

    private ResultActions as(AppUser user, MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + jwtService.issueAccessToken(user)));
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    /** The ids of the audit page for {@link #actor} plus {@code params}. */
    private List<Long> ids(String... params) throws Exception {
        MockHttpServletRequestBuilder request =
                get("/api/v1/admin/audit").param("userId", actor.getId().toString()).param("size", "200");
        for (int i = 0; i < params.length; i += 2) {
            request.param(params[i], params[i + 1]);
        }
        JsonNode page = json(as(admin, request));
        return StreamSupport.stream(page.get("content").spliterator(), false)
                .map(e -> e.get("id").asLong())
                .toList();
    }

    private JsonNode row(JsonNode list, String key) {
        return StreamSupport.stream(list.spliterator(), false)
                .filter(r -> r.get("key").asText().equals(key))
                .findFirst()
                .orElse(null);
    }

    // ---------------------------------------------------------------- audit

    @Test
    void auditFiltersWorkAloneAndCombined() throws Exception {
        Project other = newProject("other");
        AuditLog login = entry(null, "LOGIN_SUCCESS", 0);
        AuditLog created = entry(null, "USER_CREATED", 10);
        AuditLog role = entry(project.getId(), "MEMBER_ROLE_SET", 20);
        AuditLog removed = entry(project.getId(), "MEMBER_REMOVED", 30);
        AuditLog otherRole = entry(other.getId(), "MEMBER_ROLE_SET", 40);

        // userId alone: all five, newest first.
        assertThat(ids()).containsExactly(
                otherRole.getId(), removed.getId(), role.getId(), created.getId(), login.getId());
        // action, repeatable.
        assertThat(ids("action", "MEMBER_ROLE_SET")).containsExactly(otherRole.getId(), role.getId());
        assertThat(ids("action", "LOGIN_SUCCESS", "action", "USER_CREATED"))
                .containsExactly(created.getId(), login.getId());
        // project key, and the instance-only filter.
        assertThat(ids("project", project.getKey())).containsExactly(removed.getId(), role.getId());
        assertThat(ids("project", "_instance")).containsExactly(created.getId(), login.getId());
        // from inclusive, to exclusive.
        assertThat(ids("from", base.plus(10, ChronoUnit.MINUTES).toString(), "to", base.plus(30, ChronoUnit.MINUTES).toString()))
                .containsExactly(role.getId(), created.getId());
        // combined.
        assertThat(ids(
                        "action", "MEMBER_ROLE_SET",
                        "project", project.getKey(),
                        "from", base.toString()))
                .containsExactly(role.getId());
        assertThat(ids("action", "MEMBER_ROLE_SET", "project", "_instance")).isEmpty();
    }

    @Test
    void auditRowsNameTheActorAndTheProject() throws Exception {
        AuditLog inProject = entry(project.getId(), "MEMBER_ROLE_SET", 0);
        entry(null, "USER_CREATED", 1);

        JsonNode content = json(as(admin, get("/api/v1/admin/audit")
                        .param("userId", actor.getId().toString())))
                .get("content");
        assertThat(content).hasSize(2);
        JsonNode instance = content.get(0);
        assertThat(instance.get("action").asText()).isEqualTo("USER_CREATED");
        assertThat(instance.get("projectKey").isNull()).isTrue();
        assertThat(instance.get("actor").get("id").asLong()).isEqualTo(actor.getId());
        assertThat(instance.get("actor").get("username").asText()).isEqualTo(actor.getUsername());
        JsonNode projectRow = content.get(1);
        assertThat(projectRow.get("id").asLong()).isEqualTo(inProject.getId());
        assertThat(projectRow.get("projectKey").asText()).isEqualTo(project.getKey());
        assertThat(projectRow.get("target").asText()).isEqualTo("t:MEMBER_ROLE_SET");
        assertThat(projectRow.get("timestamp").asText()).isEqualTo(base.toString());

        // A deleted actor shows as "Deleted user".
        administration.delete(actor.getId(), actor.getUsername(), admin.getId());
        JsonNode after = json(as(admin, get("/api/v1/admin/audit")
                        .param("userId", actor.getId().toString())
                        .param("project", project.getKey())))
                .get("content");
        assertThat(after.get(0).get("actor").get("username").asText()).isEqualTo("Deleted user");
    }

    @Test
    void auditPagingIsStableForEntriesWithTheSameTimestamp() throws Exception {
        List<Long> expected = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            expected.add(0, entry(null, "LOGIN_SUCCESS", 0).getId());
        }

        List<Long> paged = new ArrayList<>();
        for (int page = 0; page < 3; page++) {
            JsonNode result = json(as(admin, get("/api/v1/admin/audit")
                    .param("userId", actor.getId().toString())
                    .param("page", String.valueOf(page))
                    .param("size", "2")
                    .param("sort", "action,asc")));
            assertThat(result.get("page").get("totalElements").asLong()).isEqualTo(5);
            assertThat(result.get("page").get("totalPages").asInt()).isEqualTo(3);
            result.get("content").forEach(e -> paged.add(e.get("id").asLong()));
        }
        assertThat(paged).containsExactlyElementsOf(expected);
    }

    @Test
    void auditRejectsBadInputAndListsActions() throws Exception {
        entry(null, "ZZ_AUDIT_TEST_ACTION", 0);

        as(admin, get("/api/v1/admin/audit").param("from", "yesterday"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.field").value("from"));
        as(admin, get("/api/v1/admin/audit").param("size", "201")).andExpect(status().isBadRequest());
        as(admin, get("/api/v1/admin/audit").param("project", "no_such_project")).andExpect(status().isNotFound());

        List<String> actions = List.of(objectMapper.readValue(
                json(as(admin, get("/api/v1/admin/audit/actions"))).toString(), String[].class));
        assertThat(actions).contains("ZZ_AUDIT_TEST_ACTION", "MEMBER_ROLE_SET").isSorted().doesNotHaveDuplicates();
    }

    @Test
    void onlyInstanceAdminsReachTheAdminEndpoints() throws Exception {
        projectService.setMemberRole(project.getKey(), actor.getId(), ProjectRole.PROJECT_ADMIN,
                RevisionContext.of(project.getId(), admin.getId(), null));
        as(actor, get("/api/v1/admin/audit")).andExpect(status().isForbidden());
        as(actor, get("/api/v1/admin/audit/actions")).andExpect(status().isForbidden());
        as(actor, get("/api/v1/admin/projects")).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/admin/projects")).andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------- projects

    @Test
    void projectsOverviewCountsMembersAndShowsTheLastChange() throws Exception {
        // Untouched since creation: one member (the creator), head = the creation revision.
        Revision creation = revisions.findByProjectIdOrderByRevisionIdDesc(project.getId()).get(0);
        JsonNode fresh = row(json(as(admin, get("/api/v1/admin/projects"))), project.getKey());
        assertThat(fresh.get("memberCount").asLong()).isEqualTo(1);
        assertThat(fresh.get("headRevision").asLong()).isEqualTo(creation.getRevisionId());
        assertThat(Instant.parse(fresh.get("lastChangeAt").asText())).isEqualTo(creation.getCreatedAt());
        assertThat(fresh.get("name").asText()).isEqualTo(project.getName());
        assertThat(fresh.get("archived").asBoolean()).isFalse();
        assertThat(fresh.get("createdAt").isNull()).isFalse();

        // Two more members, each a revision.
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), null);
        projectService.setMemberRole(project.getKey(), actor.getId(), ProjectRole.EDITOR, ctx);
        projectService.setMemberRole(project.getKey(), newUser("aud-viewer").getId(), ProjectRole.VIEWER, ctx);
        Revision head = revisions.findByProjectIdOrderByRevisionIdDesc(project.getId()).get(0);
        JsonNode changed = row(json(as(admin, get("/api/v1/admin/projects"))), project.getKey());
        assertThat(changed.get("memberCount").asLong()).isEqualTo(3);
        assertThat(changed.get("headRevision").asLong()).isEqualTo(head.getRevisionId()).isGreaterThan(
                creation.getRevisionId());
        assertThat(Instant.parse(changed.get("lastChangeAt").asText())).isEqualTo(head.getCreatedAt());
    }

    @Test
    void projectsOverviewFiltersByTextAndArchivedState() throws Exception {
        Project archived = newProject("archived");
        projectService.archive(archived.getKey(), RevisionContext.of(archived.getId(), admin.getId(), null));

        JsonNode all = json(as(admin, get("/api/v1/admin/projects")));
        assertThat(row(all, archived.getKey()).get("archived").asBoolean()).isTrue();
        List<String> keys = StreamSupport.stream(all.spliterator(), false).map(r -> r.get("key").asText()).toList();
        assertThat(keys).isSorted();

        JsonNode active = json(as(admin, get("/api/v1/admin/projects").param("includeArchived", "false")));
        assertThat(row(active, archived.getKey())).isNull();
        assertThat(row(active, project.getKey())).isNotNull();

        // q matches key, name and description, ignoring case.
        JsonNode byName = json(as(admin, get("/api/v1/admin/projects").param("q", project.getName().toUpperCase())));
        assertThat(byName).hasSize(1);
        assertThat(row(byName, project.getKey())).isNotNull();
        JsonNode byDescription = json(as(admin, get("/api/v1/admin/projects").param("q", project.getDescription())));
        assertThat(row(byDescription, project.getKey())).isNotNull();
        assertThat(json(as(admin, get("/api/v1/admin/projects").param("q", "no-such-project-anywhere")))).isEmpty();
    }
}
