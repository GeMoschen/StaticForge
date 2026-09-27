package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.revision.compaction.CompactionPolicy;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The compaction policy (M29.4.1): {@code GET/PUT /projects/{key}/compaction} with the typed confirmation
 * ({@code SF-DOM-0182}), the 30-day minimum ({@code SF-DOM-0183}), role and archive guards, the audit entry and the
 * schema defaults. The estimate is covered with real history in {@code RevisionCompactionIntegrationTest}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CompactionPolicyApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired com.acme.staticforge.user.AppUserRepository appUsers;
    @Autowired ProjectService projects;
    @Autowired AuditService audit;
    @Autowired RevisionRepository revisions;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser admin, String token) {
        String key() {
            return project.getKey();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "compaction policy");
        }
    }

    @Test
    @DisplayName("a new project is off: GET shows the defaults and no run; existing revisions are not compacted")
    void defaults() throws Exception {
        Fixture fx = fixture("cp-new");

        perform(get("/api/v1/projects/{key}/compaction", fx.key()), fx.token())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.olderThanDays").value(CompactionPolicy.DEFAULT_OLDER_THAN_DAYS))
                .andExpect(jsonPath("$.enabledAt").isEmpty())
                .andExpect(jsonPath("$.compactedThrough").isEmpty())
                .andExpect(jsonPath("$.lastRun").isEmpty());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM revision WHERE project_id = ? AND compacted = TRUE",
                        Long.class, fx.project().getId()))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT compaction_policy FROM project WHERE id = ?", String.class,
                        fx.project().getId()))
                .isNull();
    }

    @Test
    @DisplayName("enabling needs ?confirm=<project key>: missing or wrong is 422 SF-DOM-0182 and stores nothing")
    void enableNeedsConfirmation() throws Exception {
        Fixture fx = fixture("cp-confirm");

        putPolicy(fx, fx.token(), null, "{\"enabled\": true, \"olderThanDays\": 60}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0182"))
                .andExpect(jsonPath("$.projectKey").value(fx.key()));
        putPolicy(fx, fx.token(), fx.key() + "x", "{\"enabled\": true, \"olderThanDays\": 60}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0182"));
        assertThat(projects.requireByKey(fx.key()).getCompactionPolicy()).isNull();
        assertThat(actions(fx)).doesNotContain("COMPACTION_POLICY_SET");
    }

    @Test
    @DisplayName("olderThanDays below 30 is 422 SF-DOM-0183, confirmed or not, and for the estimate too")
    void minimumAge() throws Exception {
        Fixture fx = fixture("cp-min");

        putPolicy(fx, fx.token(), fx.key(), "{\"enabled\": true, \"olderThanDays\": 29}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0183"))
                .andExpect(jsonPath("$.minimum").value(30));
        putPolicy(fx, fx.token(), null, "{\"enabled\": false, \"olderThanDays\": 29}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0183"));
        perform(get("/api/v1/projects/{key}/compaction/estimate?olderThanDays=29", fx.key()), fx.token())
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0183"));
        putPolicy(fx, fx.token(), fx.key(), "{\"enabled\": true, \"olderThanDays\": 30}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.olderThanDays").value(30));
    }

    @Test
    @DisplayName("round trip: enable (confirmed), raise (no confirm), lower (confirm), disable (no confirm); each audited")
    void roundTrip() throws Exception {
        Fixture fx = fixture("cp-trip");
        int revisionsBefore = revisions.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).size();

        putPolicy(fx, fx.token(), fx.key(), "{\"enabled\": true, \"olderThanDays\": 60}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.olderThanDays").value(60))
                .andExpect(jsonPath("$.enabledBy").value(fx.admin().getId()))
                .andExpect(jsonPath("$.enabledAt").isNotEmpty());
        CompactionPolicy enabled = CompactionPolicy.fromJson(projects.requireByKey(fx.key()).getCompactionPolicy());
        assertThat(enabled.enabled()).isTrue();

        putPolicy(fx, fx.token(), null, "{\"enabled\": true, \"olderThanDays\": 120}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.olderThanDays").value(120));
        putPolicy(fx, fx.token(), null, "{\"enabled\": true, \"olderThanDays\": 90}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0182"));
        putPolicy(fx, fx.token(), fx.key(), "{\"enabled\": true, \"olderThanDays\": 90}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.olderThanDays").value(90))
                // Still the same enabling: raising and lowering keep when and by whom it was switched on.
                .andExpect(jsonPath("$.enabledAt").value(enabled.enabledAt().toString()));

        putPolicy(fx, fx.token(), null, "{\"enabled\": false}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.olderThanDays").value(90))
                .andExpect(jsonPath("$.enabledAt").isEmpty());
        // Unchanged: nothing recorded.
        putPolicy(fx, fx.token(), null, "{\"enabled\": false}").andExpect(status().isOk());

        perform(get("/api/v1/projects/{key}/compaction", fx.key()), fx.token())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.olderThanDays").value(90));

        List<AuditLog> entries = audit.findRecent(fx.project().getId(), PageRequest.of(0, 50)).stream()
                .filter(e -> e.getAction().equals("COMPACTION_POLICY_SET"))
                .toList();
        assertThat(entries).hasSize(4);
        AuditLog first = entries.get(entries.size() - 1);
        assertThat(first.getTarget()).isEqualTo("project:" + fx.key());
        assertThat(first.getActorUserId()).isEqualTo(fx.admin().getId());
        assertThat(first.getDetail().path("before").isNull()).isTrue();
        assertThat(first.getDetail().path("after").path("enabled").asBoolean()).isTrue();
        JsonNode last = entries.get(0).getDetail();
        assertThat(last.path("before").path("enabled").asBoolean()).isTrue();
        assertThat(last.path("after").path("enabled").asBoolean()).isFalse();
        // No revision: the setting doesn't change any output.
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(fx.project().getId())).hasSize(revisionsBefore);
    }

    @Test
    @DisplayName("below PROJECT_ADMIN: 403 for GET, PUT and the estimate")
    void projectAdminOnly() throws Exception {
        Fixture fx = fixture("cp-role");
        String developer = member(fx, ProjectRole.DEVELOPER);

        perform(get("/api/v1/projects/{key}/compaction", fx.key()), developer).andExpect(status().isForbidden());
        putPolicy(fx, developer, fx.key(), "{\"enabled\": true, \"olderThanDays\": 60}").andExpect(status().isForbidden());
        perform(get("/api/v1/projects/{key}/compaction/estimate?olderThanDays=60", fx.key()), developer)
                .andExpect(status().isForbidden());
        assertThat(projects.requireByKey(fx.key()).getCompactionPolicy()).isNull();
    }

    @Test
    @DisplayName("archived: PUT is 409 SF-DOM-0141 (enable and disable); GET and the estimate still answer")
    void archivedProject() throws Exception {
        Fixture fx = fixture("cp-arch");
        putPolicy(fx, fx.token(), fx.key(), "{\"enabled\": true, \"olderThanDays\": 60}").andExpect(status().isOk());
        projects.archive(fx.key(), fx.ctx());
        String instanceAdmin = instanceAdminToken();
        try {
            putPolicy(fx, instanceAdmin, null, "{\"enabled\": false}")
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("SF-DOM-0141"));
            putPolicy(fx, instanceAdmin, fx.key(), "{\"enabled\": true, \"olderThanDays\": 45}")
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("SF-DOM-0141"));
            perform(get("/api/v1/projects/{key}/compaction", fx.key()), instanceAdmin)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.enabled").value(true));
            perform(get("/api/v1/projects/{key}/compaction/estimate?olderThanDays=60", fx.key()), instanceAdmin)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.versionsRemoved").value(0));
        } finally {
            projects.unarchive(fx.key(), fx.ctx());
        }
        assertThat(CompactionPolicy.fromJson(projects.requireByKey(fx.key()).getCompactionPolicy()).olderThanDays())
                .isEqualTo(60);
    }

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(
                new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "compaction"), admin.getId());
        return new Fixture(project, admin, jwt.issueAccessToken(users.findById(admin.getId()).orElseThrow()));
    }

    private String member(Fixture fx, ProjectRole role) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("cpm" + n, "cpm" + n + "@example.com", "Member", "secret-password");
        projects.setMemberRole(fx.key(), user.getId(), role, fx.ctx());
        return jwt.issueAccessToken(users.findById(user.getId()).orElseThrow());
    }

    private String instanceAdminToken() {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("cpia" + n, "cpia" + n + "@example.com", "Instance admin", "secret-password");
        user.setSystemRole(SystemRole.INSTANCE_ADMIN);
        return jwt.issueAccessToken(appUsers.save(user));
    }

    private List<String> actions(Fixture fx) {
        return audit.findRecent(fx.project().getId(), PageRequest.of(0, 50)).stream().map(AuditLog::getAction).toList();
    }

    private ResultActions putPolicy(Fixture fx, String token, String confirm, String body) throws Exception {
        MockHttpServletRequestBuilder request = put("/api/v1/projects/{key}/compaction", fx.key())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
        if (confirm != null) {
            request.param("confirm", confirm);
        }
        return perform(request, token);
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, String token) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }
}
