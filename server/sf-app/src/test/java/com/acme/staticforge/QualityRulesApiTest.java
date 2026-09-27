package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
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
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * {@code GET/PUT /projects/{key}/quality-rules} (M30.1.2, epic decision 4): defaults, overrides, reset, validation,
 * roles, the archived guard, and exactly one revision and audit entry per change.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(QualityTestRules.class)
class QualityRulesApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired AppUserRepository appUsers;
    @Autowired ProjectService projects;
    @Autowired RevisionRepository revisions;
    @Autowired AuditService audit;
    @Autowired QualityRuleConfigService configService;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser admin, RevisionContext ctx, String adminToken) {
        String key() {
            return project.getKey();
        }

        long id() {
            return project.getId();
        }
    }

    @Test
    void everyRuleIsListedAtItsDefaults() throws Exception {
        Fixture fx = fixture("qr-get");
        String viewer = member(fx, ProjectRole.VIEWER);

        perform(get("/api/v1/projects/{key}/quality-rules", fx.key()), viewer)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rules[*].code", hasItem("SF-CHK-0001")))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0001')].maxSeverity").value("WARNING"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].kind").value("PAGE"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].category").value("ACCESSIBILITY"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].severity").value("WARNING"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].defaultSeverity").value("WARNING"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].channels").value("HTML channels only"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].params[0].name").value("limit"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].params[0].value").value(10))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].params[0].min").value(1))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].params[0].max").value(100))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].params[1].value").value(false))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0190')].kind").value("SITE"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0191')].maxSeverity").value("WARNING"));
        assertThat(projects.requireByKey(fx.key()).getQualityRuleConfig()).isNull();
    }

    @Test
    void overrideAndResetRoundTripWithOneRevisionAndAuditEntryPerChange() throws Exception {
        Fixture fx = fixture("qr-put");
        String developer = member(fx, ProjectRole.DEVELOPER);
        int revisionsBefore = revisions.findByProjectIdOrderByRevisionIdDesc(fx.id()).size();

        putRules(fx, developer, """
                {"rules": {"SF-CHK-0390": {"severity": "ERROR", "params": {"limit": 3}},
                           "SF-CHK-0190": {"severity": "OFF"},
                           "SF-CHK-0001": {"severity": "WARNING"}}}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].severity").value("ERROR"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].params[0].value").value(3))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0190')].severity").value("OFF"));

        assertThat(projects.requireByKey(fx.key()).getQualityRuleConfig())
                .as("only what differs from the defaults is stored")
                .isEqualTo(mapper.readTree("""
                        {"rules": {"SF-CHK-0190": {"severity": "OFF"},
                                   "SF-CHK-0390": {"severity": "ERROR", "params": {"limit": 3}}}}
                        """));
        List<Revision> after = revisions.findByProjectIdOrderByRevisionIdDesc(fx.id());
        assertThat(after).hasSize(revisionsBefore + 1);
        assertThat(after.get(0).getSummary().toString()).contains("\"PROJECT\"").contains("qualityRules");
        assertThat(configService.qualityRulesChangedSince(fx.id(), after.get(1).getRevisionId())).isTrue();
        assertThat(configService.qualityRulesChangedSince(fx.id(), after.get(0).getRevisionId())).isFalse();
        assertThat(auditEntries(fx)).singleElement().satisfies(entry -> {
            assertThat(entry.getTarget()).isEqualTo("project:" + fx.key());
            assertThat(entry.getDetail().path("changed").toString()).isEqualTo("[\"SF-CHK-0190\",\"SF-CHK-0390\"]");
        });

        // The same configuration again changes nothing: no revision, no audit entry.
        putRules(fx, developer, """
                {"rules": {"SF-CHK-0390": {"severity": "ERROR", "params": {"limit": 3, "strict": false}},
                           "SF-CHK-0190": {"severity": "OFF"}}}
                """).andExpect(status().isOk());
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(fx.id())).hasSize(revisionsBefore + 1);
        assertThat(auditEntries(fx)).hasSize(1);

        // Back to the defaults removes the stored entries.
        putRules(fx, developer, """
                {"rules": {"SF-CHK-0390": {"severity": "WARNING", "params": {"limit": 10}}}}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0190')].severity").value("WARNING"));
        assertThat(projects.requireByKey(fx.key()).getQualityRuleConfig()).isNull();
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(fx.id())).hasSize(revisionsBefore + 2);
        assertThat(auditEntries(fx)).hasSize(2);
    }

    @Test
    void anInvalidBodyIsRejectedWithOneMessagePerEntryAndStoresNothing() throws Exception {
        Fixture fx = fixture("qr-bad");
        int revisionsBefore = revisions.findByProjectIdOrderByRevisionIdDesc(fx.id()).size();

        putRules(fx, fx.adminToken(), """
                {"rules": {"SF-CHK-9999": {"severity": "ERROR"},
                           "SF-CHK-0190": {"severity": "LOUD"},
                           "SF-CHK-0390": {"params": {"limit": 500, "strict": "yes", "colour": 1}}}}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SF-API-0400"))
                .andExpect(jsonPath("$.errors", containsInAnyOrder(
                        "SF-CHK-9999: unknown rule.",
                        "SF-CHK-0190: severity must be one of OFF, WARNING, ERROR.",
                        "SF-CHK-0390: limit must be at most 100.",
                        "SF-CHK-0390: strict must be true or false.",
                        "SF-CHK-0390: unknown parameter 'colour'.")));

        assertThat(projects.requireByKey(fx.key()).getQualityRuleConfig()).isNull();
        assertThat(revisions.findByProjectIdOrderByRevisionIdDesc(fx.id())).hasSize(revisionsBefore);
        assertThat(auditEntries(fx)).isEmpty();
    }

    @Test
    void onlyDevelopersWriteAndArchivedProjectsRefuse() throws Exception {
        Fixture fx = fixture("qr-roles");
        String body = "{\"rules\": {\"SF-CHK-0390\": {\"severity\": \"OFF\"}}}";

        putRules(fx, member(fx, ProjectRole.EDITOR), body).andExpect(status().isForbidden());
        putRules(fx, member(fx, ProjectRole.VIEWER), body).andExpect(status().isForbidden());
        putRules(fx, fx.adminToken(), body).andExpect(status().isOk());

        projects.archive(fx.key(), fx.ctx());
        String instanceAdmin = instanceAdminToken();
        putRules(fx, instanceAdmin, "{\"rules\": {}}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0141"));
        perform(get("/api/v1/projects/{key}/quality-rules", fx.key()), instanceAdmin)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0390')].severity").value("OFF"));
        projects.unarchive(fx.key(), fx.ctx());
    }

    // ------------------------------------------------------------------

    private List<AuditLog> auditEntries(Fixture fx) {
        return audit.findRecent(fx.id(), PageRequest.of(0, 50)).stream()
                .filter(entry -> entry.getAction().equals("QUALITY_RULES_UPDATED"))
                .toList();
    }

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(
                new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "quality rules"), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "quality rules");
        return new Fixture(project, admin, ctx, jwt.issueAccessToken(users.findById(admin.getId()).orElseThrow()));
    }

    private String member(Fixture fx, ProjectRole role) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("qr" + n + role.name().toLowerCase(), "qr" + n + "@example.com", "Member", "secret-password");
        projects.setMemberRole(fx.key(), user.getId(), role, fx.ctx());
        return jwt.issueAccessToken(users.findById(user.getId()).orElseThrow());
    }

    private String instanceAdminToken() {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("qria" + n, "qria" + n + "@example.com", "Instance admin", "secret-password");
        user.setSystemRole(SystemRole.INSTANCE_ADMIN);
        return jwt.issueAccessToken(appUsers.save(user));
    }

    private ResultActions putRules(Fixture fx, String token, String body) throws Exception {
        return perform(put("/api/v1/projects/{key}/quality-rules", fx.key())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body), token);
    }

    private ResultActions perform(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request, String token)
            throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }
}
