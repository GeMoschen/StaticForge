package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.recovery.GenerationRunRecoveryJob;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJobFixtures;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Recovery at startup (M29.2.1): a {@code RUNNING} run this node left behind (a restart) — and a queued row from before
 * M29, without a node — are in the database when the application becomes ready; the startup run of
 * {@code generation-run-recovery} fails both with {@code SF-GEN-0504}, leaves another node's live run alone, and the
 * project accepts a new build ({@code 202}, not {@code 409}).
 *
 * <p>The context enables {@code sf.housekeeping} (off in the {@code test} profile) with a fixed {@code sf.node-id}; the
 * rows are written by an application-ready listener ordered before the job starter, i.e. exactly as a restarted node
 * finds them.
 */
@SpringBootTest(properties = {"sf.housekeeping.enabled=true", "sf.node-id=" + GenerationRunStartupRecoveryTest.NODE})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GenerationRunStartupRecoveryTest {

    static final String NODE = "startup-node-1";

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        String root = Files.createTempDirectory("sf-startup-recovery").toString();
        registry.add("sf.generate.output-root", () -> root);
    }

    /** The rows a crashed node leaves, written before the system jobs start. */
    @TestConfiguration
    static class LeftBehind {

        @Bean
        Rows leftBehindRows(UserService users, ProjectService projects, GenerationTargetRepository targets,
                GenerationRunRepository runs, JdbcTemplate jdbc) {
            return new Rows(users, projects, targets, runs, jdbc);
        }
    }

    static final class Rows implements ApplicationListener<ApplicationReadyEvent>, Ordered {

        private final UserService users;
        private final ProjectService projects;
        private final GenerationTargetRepository targets;
        private final GenerationRunRepository runs;
        private final JdbcTemplate jdbc;

        AppUser user;
        Project project;
        long ownRun;
        long legacyRun;
        long liveForeignRun;

        Rows(UserService users, ProjectService projects, GenerationTargetRepository targets, GenerationRunRepository runs,
                JdbcTemplate jdbc) {
            this.users = users;
            this.projects = projects;
            this.targets = targets;
            this.runs = runs;
            this.jdbc = jdbc;
        }

        @Override
        public int getOrder() {
            return Ordered.HIGHEST_PRECEDENCE;
        }

        @Override
        public void onApplicationEvent(ApplicationReadyEvent event) {
            user = users.create("startup-rec", "startup-rec@example.com", "Startup Rec", "secret-password");
            project = projects.create(new CreateProjectRequest("startuprec", "Startup Rec", null, "startup recovery"), user.getId());
            GenerationTarget target = targets.save(new GenerationTarget(
                    project.getId(), "default", TargetType.FILESYSTEM, new ObjectMapper().createObjectNode(), true));
            Instant now = Instant.now();
            ownRun = run(target, RunStatus.RUNNING, NODE, now.minusSeconds(20));
            legacyRun = run(target, RunStatus.QUEUED, null, null);
            liveForeignRun = run(target, RunStatus.RUNNING, "other-node", now);
        }

        private long run(GenerationTarget target, RunStatus status, String node, Instant heartbeat) {
            GenerationRun run = new GenerationRun(project.getId(), null, GenerationMode.FULL, null, target.getId(), status,
                    Instant.now().minus(Duration.ofMinutes(1)), null, user.getId(), 0, 0, 0, 0, 0, null, null);
            run.setExecutorNode(node);
            long id = runs.saveAndFlush(run).getId();
            if (heartbeat != null) {
                jdbc.update("UPDATE generation_run SET heartbeat_at = ? WHERE id = ?",
                        OffsetDateTime.ofInstant(heartbeat, ZoneOffset.UTC), id);
            }
            return id;
        }
    }

    @Autowired Rows rows;
    @Autowired GenerationRunRepository runs;
    @Autowired SystemJobFixtures jobFixtures;
    @Autowired JwtService jwt;
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @Test
    void aRestartFailsThisNodesRunsAndTheProjectBuildsAgain() throws Exception {
        SystemJobRun startup = awaitStartupRun();
        assertThat(startup.getOutcome()).isNotNull();

        for (long id : List.of(rows.ownRun, rows.legacyRun)) {
            GenerationRun run = runs.findById(id).orElseThrow();
            assertThat(run.getStatus()).as("run %s", id).isEqualTo(RunStatus.FAILED);
            assertThat(run.getDiagnostics().path("errors").get(0).path("code").asText()).isEqualTo("SF-GEN-0504");
        }
        assertThat(startup.getReport().path("recovered").path("startuprec")).hasSize(2);

        // Another node's run with a fresh heartbeat is not this node's to judge at startup.
        assertThat(runs.findById(rows.liveForeignRun).orElseThrow().getStatus()).isEqualTo(RunStatus.RUNNING);
        jdbc.update("UPDATE generation_run SET status = 'CANCELLED' WHERE id = ?", rows.liveForeignRun);

        mvc.perform(post("/api/v1/projects/startuprec/generations")
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(rows.user))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mode\":\"FULL\"}"))
                .andExpect(status().isAccepted());
    }

    private SystemJobRun awaitStartupRun() throws InterruptedException {
        long deadline = System.currentTimeMillis() + 30_000;
        while (System.currentTimeMillis() < deadline) {
            List<SystemJobRun> history = jobFixtures.runs(GenerationRunRecoveryJob.KEY);
            if (!history.isEmpty() && history.get(0).getFinishedAt() != null) {
                assertThat(history.get(0).getTrigger()).isEqualTo(JobTrigger.STARTUP);
                return history.get(0);
            }
            Thread.sleep(50);
        }
        throw new AssertionError("The startup run of " + GenerationRunRecoveryJob.KEY + " did not finish within 30s");
    }
}
