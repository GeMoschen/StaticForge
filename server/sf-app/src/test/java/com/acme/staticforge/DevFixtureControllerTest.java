package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * The journey fixture endpoint (M29.6.2) in the {@code test} profile: an instance admin back-dates a project's
 * revisions up to a given one onto a single UTC day; anyone else is refused, and bad input is a {@code 422}. That it
 * does not exist outside {@code dev}/{@code test} is {@code DevFixtureControllerProfileTest}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DevFixtureControllerTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired AppUserRepository appUsers;
    @Autowired ProjectService projects;
    @Autowired JdbcTemplate jdbc;

    @Test
    @DisplayName("an instance admin moves revisions 1..N onto one UTC day in the past, in order; later ones stay")
    void backdates() throws Exception {
        int n = SEQ.incrementAndGet();
        AppUser owner = users.create("dfo" + n, "dfo" + n + "@example.com", "Owner", "secret-password");
        Project project = projects.create(new CreateProjectRequest("devfix" + n, "Dev fixture " + n, null, "fixture"),
                owner.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), owner.getId(), "edit");
        projects.update(project.getKey(), "Renamed once " + n, null, null, ctx);
        projects.update(project.getKey(), "Renamed twice " + n, null, null, ctx);
        long head = head(project);
        assertThat(head).isGreaterThanOrEqualTo(3);
        Instant before = createdAt(project, head);

        backdate(project.getKey(), "{\"days\": 40, \"throughRevision\": " + (head - 1) + "}", instanceAdminToken())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revisionsShifted").value((int) (head - 1)));

        LocalDate expectedDay = LocalDate.now(ZoneOffset.UTC).minusDays(40);
        Instant previous = Instant.MIN;
        for (long r = 1; r < head; r++) {
            Instant at = createdAt(project, r);
            assertThat(LocalDate.ofInstant(at, ZoneOffset.UTC)).as("day of r%d", r).isEqualTo(expectedDay);
            assertThat(at).as("order of r%d", r).isAfter(previous);
            previous = at;
        }
        assertThat(createdAt(project, head)).isEqualTo(before);
    }

    @Test
    @DisplayName("a project admin who is no instance admin is refused, and out-of-range input is a 422")
    void guarded() throws Exception {
        int n = SEQ.incrementAndGet();
        AppUser owner = users.create("dfg" + n, "dfg" + n + "@example.com", "Owner", "secret-password");
        Project project = projects.create(new CreateProjectRequest("devfixg" + n, "Dev fixture g" + n, null, "fixture"),
                owner.getId());
        Instant before = createdAt(project, 1);

        backdate(project.getKey(), "{\"days\": 40, \"throughRevision\": 1}",
                        jwt.issueAccessToken(users.findById(owner.getId()).orElseThrow()))
                .andExpect(status().isForbidden());
        String admin = instanceAdminToken();
        for (String body : List.of(
                "{\"days\": 0, \"throughRevision\": 1}",
                "{\"days\": 4000, \"throughRevision\": 1}",
                "{\"days\": 40, \"throughRevision\": 0}")) {
            backdate(project.getKey(), body, admin).andExpect(status().isUnprocessableEntity());
        }
        assertThat(createdAt(project, 1)).isEqualTo(before);
    }

    private ResultActions backdate(String key, String body, String token) throws Exception {
        return mvc.perform(post("/api/v1/dev/fixtures/projects/{key}/backdate-revisions", key)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private String instanceAdminToken() {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("dfia" + n, "dfia" + n + "@example.com", "Instance admin", "secret-password");
        user.setSystemRole(SystemRole.INSTANCE_ADMIN);
        return jwt.issueAccessToken(appUsers.save(user));
    }

    private long head(Project project) {
        return jdbc.queryForObject("SELECT MAX(revision_id) FROM revision WHERE project_id = ?", Long.class,
                project.getId());
    }

    private Instant createdAt(Project project, long revision) {
        return jdbc.queryForObject("SELECT created_at FROM revision WHERE project_id = ? AND revision_id = ?",
                        OffsetDateTime.class, project.getId(), revision)
                .toInstant()
                .truncatedTo(ChronoUnit.MICROS);
    }
}
