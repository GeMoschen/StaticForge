package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditLogRepository;
import com.acme.staticforge.housekeeping.BlockingJob;
import com.acme.staticforge.housekeeping.FailingJob;
import com.acme.staticforge.housekeeping.JobOutcome;
import com.acme.staticforge.housekeeping.NoopJob;
import com.acme.staticforge.housekeeping.SystemJob;
import com.acme.staticforge.housekeeping.SystemJobRepository;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunRepository;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.housekeeping.SystemJobService;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The admin jobs API (M29.1.2) over the test job beans ({@link NoopJob}, {@link FailingJob}, {@link BlockingJob}):
 * access, list/detail/history, validated edits with {@code If-Match}, reset, run now and dry run, the running
 * conflict (also against a scheduled claim of the same job) and the audit entries.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AdminJobApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String BASE = "/api/v1/admin/jobs";
    private static final java.util.concurrent.Executor THREADS = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired AppUserRepository users;
    @Autowired JwtService jwtService;
    @Autowired AuditLogRepository auditLog;
    @Autowired SystemJobService jobService;
    @Autowired SystemJobRunner runner;
    @Autowired SystemJobRepository jobRows;
    @Autowired SystemJobRunRepository runs;
    @Autowired BlockingJob blocking;
    @Autowired JdbcTemplate jdbc;

    private AppUser admin;

    @BeforeEach
    void setUp() {
        admin = newAdmin();
        for (String key : List.of(NoopJob.KEY, FailingJob.KEY, BlockingJob.KEY)) {
            jobService.reset(key, null);
        }
    }

    @AfterEach
    void releaseBlocking() {
        blocking.release();
    }

    // ---------------------------------------------------------------- fixtures

    private AppUser newUser(String prefix) {
        int n = SEQ.incrementAndGet();
        return userService.create("aj-" + prefix + "-" + n, "aj-" + prefix + "-" + n + "@example.com", "Aj " + n,
                "secret-password");
    }

    private AppUser newAdmin() {
        AppUser user = newUser("admin");
        user.setSystemRole(SystemRole.INSTANCE_ADMIN);
        return users.save(user);
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, AppUser as) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + jwtService.issueAccessToken(as)));
    }

    private ResultActions send(MockHttpServletRequestBuilder request, AppUser as, Object body) throws Exception {
        return perform(request.contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body)), as);
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private static Map<String, Object> body(Object... keyValues) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            map.put((String) keyValues[i], keyValues[i + 1]);
        }
        return map;
    }

    private String etag(String key) throws Exception {
        return perform(get(BASE + "/" + key), admin).andReturn().getResponse().getHeader(HttpHeaders.ETAG);
    }

    /** Waits until run {@code id} has finished and returns it. */
    private SystemJobRun awaitFinished(long id) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < deadline) {
            SystemJobRun run = runs.findById(id).orElseThrow();
            if (run.isFinished() && !jobRows.findById(run.getJobKey()).orElseThrow().isLeased(Instant.now())) {
                return run;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("run " + id + " did not finish");
    }

    /** Waits until job {@code key} holds no lease and its newest run has finished. */
    private void awaitIdle(String key) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < deadline) {
            SystemJob row = jobRows.findById(key).orElseThrow();
            boolean lastFinished = row.getLastRunId() == null
                    || runs.findById(row.getLastRunId()).map(SystemJobRun::isFinished).orElse(true);
            if (!row.isLeased(Instant.now()) && lastFinished) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("job " + key + " did not become idle");
    }

    private List<AuditLog> audit(String action, String key) {
        return auditLog.findAll().stream()
                .filter(e -> action.equals(e.getAction()) && ("job:" + key).equals(e.getTarget()))
                .toList();
    }

    // ---------------------------------------------------------------- access

    @Test
    @DisplayName("every endpoint is forbidden to a non-admin")
    void forbiddenToNonAdmins() throws Exception {
        AppUser plain = newUser("plain");
        String one = BASE + "/" + NoopJob.KEY;
        perform(get(BASE), plain).andExpect(status().isForbidden());
        perform(get(one), plain).andExpect(status().isForbidden());
        perform(get(one + "/runs"), plain).andExpect(status().isForbidden());
        perform(get(one + "/runs/1"), plain).andExpect(status().isForbidden());
        send(patch(one).header(HttpHeaders.IF_MATCH, "\"v0\""), plain, body("enabled", true))
                .andExpect(status().isForbidden());
        perform(post(one + "/reset"), plain).andExpect(status().isForbidden());
        perform(post(one + "/run"), plain).andExpect(status().isForbidden());
        assertThat(runs.findByJobKeyOrderByStartedAtDescIdDesc(NoopJob.KEY, org.springframework.data.domain.Pageable.unpaged())
                        .getContent())
                .noneMatch(run -> plain.getId().equals(run.getStartedBy()));
    }

    // ---------------------------------------------------------------- list + detail

    @Test
    @DisplayName("list and detail carry schedule, settings, defaults and flags; an orphaned row is listed; unknown is 404")
    void listAndDetail() throws Exception {
        String gone = "test-gone-" + SEQ.incrementAndGet();
        jobRows.saveAndFlush(new SystemJob(gone, true, "0 1 * * *", "UTC",
                JsonNodeFactory.instance.objectNode().put("x", 1), Instant.now()));

        JsonNode list = json(perform(get(BASE), admin).andExpect(status().isOk()));
        JsonNode noop = null;
        JsonNode orphan = null;
        for (JsonNode job : list) {
            if (job.get("key").asText().equals(NoopJob.KEY)) {
                noop = job;
            } else if (job.get("key").asText().equals(gone)) {
                orphan = job;
            }
        }
        assertThat(noop).isNotNull();
        assertThat(noop.get("name").asText()).isEqualTo("Test no-op");
        assertThat(noop.get("description").asText()).isNotBlank();
        assertThat(noop.get("enabled").asBoolean()).isFalse();
        assertThat(noop.get("cron").asText()).isEqualTo("0 3 * * *");
        assertThat(noop.get("zone").asText()).isEqualTo("UTC");
        assertThat(noop.at("/settings/batchSize").asInt()).isEqualTo(100);
        assertThat(noop.at("/settings/grace").asText()).isEqualTo("PT1H");
        assertThat(noop.at("/defaults/cron").asText()).isEqualTo("0 3 * * *");
        assertThat(noop.at("/defaults/zone").asText()).isEqualTo("UTC");
        assertThat(noop.at("/defaults/settings/batchSize").asInt()).isEqualTo(100);
        assertThat(noop.get("nextRunAt").isNull()).as("disabled").isTrue();
        assertThat(noop.get("running").asBoolean()).isFalse();
        assertThat(noop.get("supportsDryRun").asBoolean()).isTrue();
        assertThat(noop.get("orphaned").asBoolean()).isFalse();
        assertThat(orphan).isNotNull();
        assertThat(orphan.get("orphaned").asBoolean()).isTrue();
        assertThat(orphan.get("name").isNull()).isTrue();
        assertThat(orphan.get("defaults").isNull()).isTrue();

        JsonNode detail = json(perform(get(BASE + "/" + NoopJob.KEY), admin)
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ETAG, "\"v" + jobRows.findById(NoopJob.KEY).orElseThrow().getVersion() + "\"")));
        assertThat(detail.get("key").asText()).isEqualTo(NoopJob.KEY);

        perform(get(BASE + "/no-such-job"), admin)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SF-DOM-0184"));
        perform(get(BASE + "/no-such-job/runs"), admin).andExpect(status().isNotFound());
        perform(post(BASE + "/" + gone + "/run"), admin)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SF-DOM-0184"));
        send(patch(BASE + "/" + gone).header(HttpHeaders.IF_MATCH, "\"v0\""), admin, body("enabled", false))
                .andExpect(status().isNotFound());
    }

    // ---------------------------------------------------------------- edit + reset

    @Test
    @DisplayName("PATCH validates cron, zone and settings (every problem listed), needs a fresh If-Match and is audited")
    void patchValidatesAndAudits() throws Exception {
        String one = BASE + "/" + NoopJob.KEY;
        String etag = etag(NoopJob.KEY);

        send(patch(one).header(HttpHeaders.IF_MATCH, etag), admin, body("cron", "61 * * * *"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0180"))
                .andExpect(jsonPath("$.errors.length()").value(1));
        send(patch(one).header(HttpHeaders.IF_MATCH, etag), admin, body("zone", "Mars/Olympus"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0180"))
                .andExpect(jsonPath("$.errors[0]").value("Unknown time zone 'Mars/Olympus'."));
        JsonNode bad = json(send(patch(one).header(HttpHeaders.IF_MATCH, etag), admin,
                        body("cron", "nope", "settings", body("batchSize", 0, "grace", "10s", "colour", "red")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0180")));
        assertThat(bad.get("errors")).hasSize(4);
        assertThat(bad.get("errors").toString())
                .contains("Unknown setting 'colour'.")
                .contains("Setting 'batchSize' must be a whole number from 1 to 10000.")
                .contains("Setting 'grace' must be at least PT1M.");
        send(patch(one), admin, body("enabled", true)).andExpect(status().isPreconditionFailed());
        assertThat(etag(NoopJob.KEY)).as("nothing stored").isEqualTo(etag);

        JsonNode saved = json(send(patch(one).header(HttpHeaders.IF_MATCH, etag), admin,
                        body("enabled", true, "cron", "30 2 * * *", "zone", "Europe/Berlin", "settings", body("batchSize", 250)))
                .andExpect(status().isOk()));
        assertThat(saved.get("enabled").asBoolean()).isTrue();
        assertThat(saved.get("cron").asText()).isEqualTo("30 2 * * *");
        assertThat(saved.get("zone").asText()).isEqualTo("Europe/Berlin");
        assertThat(saved.at("/settings/batchSize").asInt()).isEqualTo(250);
        assertThat(saved.at("/settings/grace").asText()).as("merged, not replaced").isEqualTo("PT1H");
        Instant next = Instant.parse(saved.get("nextRunAt").asText());
        assertThat(next.atZone(java.time.ZoneId.of("Europe/Berlin")).toLocalTime()).isEqualTo(java.time.LocalTime.of(2, 30));
        assertThat(saved.get("version").asLong()).isGreaterThan(Long.parseLong(etag.replaceAll("[^0-9]", "")));

        send(patch(one).header(HttpHeaders.IF_MATCH, etag), admin, body("enabled", false))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-API-0409"));

        List<AuditLog> entries = audit(SystemJobService.AUDIT_SETTINGS_SET, NoopJob.KEY);
        AuditLog entry = entries.stream().filter(e -> admin.getId().equals(e.getActorUserId())).findFirst().orElseThrow();
        assertThat(entry.getProjectId()).isNull();
        assertThat(entry.getDetail().at("/before/enabled").asBoolean()).isFalse();
        assertThat(entry.getDetail().at("/before/settings/batchSize").asInt()).isEqualTo(100);
        assertThat(entry.getDetail().at("/after/cron").asText()).isEqualTo("30 2 * * *");
        assertThat(entry.getDetail().at("/after/zone").asText()).isEqualTo("Europe/Berlin");
        assertThat(entry.getDetail().at("/after/settings/batchSize").asInt()).isEqualTo(250);
    }

    @Test
    @DisplayName("reset restores the property defaults and is audited")
    void resetRestoresDefaults() throws Exception {
        String one = BASE + "/" + NoopJob.KEY;
        send(patch(one).header(HttpHeaders.IF_MATCH, etag(NoopJob.KEY)), admin,
                        body("enabled", true, "cron", "*/5 * * * *", "settings", body("batchSize", 7)))
                .andExpect(status().isOk());

        JsonNode reset = json(perform(post(one + "/reset"), admin)
                .andExpect(status().isOk())
                .andExpect(header().exists(HttpHeaders.ETAG)));
        assertThat(reset.get("enabled").asBoolean()).isFalse();
        assertThat(reset.get("cron").asText()).isEqualTo("0 3 * * *");
        assertThat(reset.get("zone").asText()).isEqualTo("UTC");
        assertThat(reset.at("/settings/batchSize").asInt()).isEqualTo(100);
        assertThat(reset.get("nextRunAt").isNull()).isTrue();

        AuditLog entry = audit(SystemJobService.AUDIT_SETTINGS_SET, NoopJob.KEY).stream()
                .filter(e -> admin.getId().equals(e.getActorUserId()) && e.getDetail().path("reset").asBoolean())
                .findFirst()
                .orElseThrow();
        assertThat(entry.getDetail().at("/before/settings/batchSize").asInt()).isEqualTo(7);
        assertThat(entry.getDetail().at("/after/settings/batchSize").asInt()).isEqualTo(100);
    }

    // ---------------------------------------------------------------- run now

    @Test
    @DisplayName("run now and dry run answer 202 with the run; history pages newest first; the run carries its report")
    void runNowDryRunAndHistory() throws Exception {
        String one = BASE + "/" + NoopJob.KEY;
        JsonNode accepted = json(perform(post(one + "/run?dryRun=true"), admin)
                .andExpect(status().isAccepted())
                .andExpect(header().string(HttpHeaders.LOCATION, org.hamcrest.Matchers.matchesPattern(
                        "/api/v1/admin/jobs/test-noop/runs/\\d+"))));
        long dryId = accepted.get("id").asLong();
        assertThat(accepted.get("dryRun").asBoolean()).isTrue();
        assertThat(accepted.get("trigger").asText()).isEqualTo("MANUAL");
        assertThat(accepted.at("/startedBy/id").asLong()).isEqualTo(admin.getId());
        SystemJobRun dry = awaitFinished(dryId);
        assertThat(dry.getOutcome()).isEqualTo(JobOutcome.SUCCEEDED);
        assertThat(dry.getItemsAffected()).isZero();

        long realId = json(perform(post(one + "/run"), admin).andExpect(status().isAccepted())).get("id").asLong();
        awaitFinished(realId);
        long thirdId = json(perform(post(one + "/run"), admin).andExpect(status().isAccepted())).get("id").asLong();
        awaitFinished(thirdId);

        JsonNode page = json(perform(get(one + "/runs?size=2"), admin).andExpect(status().isOk()));
        assertThat(page.at("/page/size").asInt()).isEqualTo(2);
        assertThat(page.at("/page/totalElements").asLong()).isGreaterThanOrEqualTo(3);
        assertThat(page.at("/content/0/id").asLong()).isEqualTo(thirdId);
        assertThat(page.at("/content/1/id").asLong()).isEqualTo(realId);
        assertThat(page.at("/content/0/outcome").asText()).isEqualTo("SUCCEEDED");
        assertThat(page.at("/content/0/itemsAffected").asLong()).isEqualTo(2);
        assertThat(page.at("/content/0/bytesFreed").asLong()).isEqualTo(2048);
        assertThat(page.at("/content/0/sample")).hasSize(3);
        assertThat(page.at("/content/0/sampleTotal").asInt()).isEqualTo(3);
        assertThat(page.at("/content/0/report").isNull()).as("full report only on the run").isTrue();
        JsonNode next = json(perform(get(one + "/runs?size=2&page=1"), admin));
        assertThat(next.at("/content/0/id").asLong()).isEqualTo(dryId);

        JsonNode run = json(perform(get(one + "/runs/" + dryId), admin).andExpect(status().isOk()));
        assertThat(run.get("dryRun").asBoolean()).isTrue();
        assertThat(run.get("durationMs").asLong()).isGreaterThanOrEqualTo(0);
        assertThat(run.get("message").asText()).isEqualTo("Dry run: examined 3, would affect 0.");
        assertThat(run.at("/report/sample/0").asText()).isEqualTo("item-1");
        assertThat(run.at("/report/projects/demo").asInt()).isEqualTo(3);
        perform(get(one + "/runs/999999999"), admin).andExpect(status().isNotFound());

        JsonNode detail = json(perform(get(one), admin));
        assertThat(detail.at("/lastRun/id").asLong()).isEqualTo(thirdId);
        assertThat(detail.at("/lastRun/outcome").asText()).isEqualTo("SUCCEEDED");
        assertThat(detail.at("/lastRun/trigger").asText()).isEqualTo("MANUAL");
        assertThat(detail.at("/lastRun/itemsAffected").asLong()).isEqualTo(2);

        List<AuditLog> entries = audit(SystemJobService.AUDIT_RUN, NoopJob.KEY).stream()
                .filter(e -> admin.getId().equals(e.getActorUserId()))
                .toList();
        assertThat(entries).hasSize(3);
        assertThat(entries).allSatisfy(e -> assertThat(e.getProjectId()).isNull());
        assertThat(entries).anySatisfy(e -> {
            assertThat(e.getDetail().path("dryRun").asBoolean()).isTrue();
            assertThat(e.getDetail().path("runId").asLong()).isEqualTo(dryId);
        });

        perform(post(BASE + "/" + FailingJob.KEY + "/run?dryRun=true"), admin)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-DOM-0180"));
    }

    @Test
    @DisplayName("a failing job's run is recorded FAILED with a stack digest in its report")
    void failingRun() throws Exception {
        long id = json(perform(post(BASE + "/" + FailingJob.KEY + "/run"), admin).andExpect(status().isAccepted()))
                .get("id").asLong();
        awaitFinished(id);
        JsonNode run = json(perform(get(BASE + "/" + FailingJob.KEY + "/runs/" + id), admin));
        assertThat(run.get("outcome").asText()).isEqualTo("FAILED");
        assertThat(run.get("message").asText()).isEqualTo("Failed: IllegalStateException: boom");
        assertThat(run.at("/report/error/stackTrace").asText()).contains("FailingJob.run");
    }

    @Test
    @DisplayName("a second run while the job runs is 409 SF-DOM-0181; the detail shows it running")
    void conflictWhileRunning() throws Exception {
        String one = BASE + "/" + BlockingJob.KEY;
        blocking.arm();
        long id = json(perform(post(one + "/run"), admin).andExpect(status().isAccepted())).get("id").asLong();
        assertThat(blocking.awaitStarted()).isTrue();

        perform(post(one + "/run"), admin)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-DOM-0181"));
        JsonNode detail = json(perform(get(one), admin));
        assertThat(detail.get("running").asBoolean()).isTrue();
        assertThat(detail.get("currentRunId").asLong()).isEqualTo(id);
        assertThat(detail.get("startedAt").isNull()).isFalse();
        JsonNode open = json(perform(get(one + "/runs/" + id), admin));
        assertThat(open.get("outcome").isNull()).isTrue();
        assertThat(open.get("finishedAt").isNull()).isTrue();

        blocking.release();
        assertThat(awaitFinished(id).getOutcome()).isEqualTo(JobOutcome.SUCCEEDED);
        assertThat(json(perform(get(one), admin)).get("running").asBoolean()).isFalse();
    }

    @Test
    @DisplayName("run now racing the scheduled claim of the same due job: exactly one runs, the other is refused or skipped")
    void apiRunRacesScheduledClaim() throws Exception {
        String one = BASE + "/" + BlockingJob.KEY;
        for (int round = 0; round < 5; round++) {
            jobService.update(BlockingJob.KEY, jobRows.findById(BlockingJob.KEY).orElseThrow().getVersion(),
                    new SystemJobService.Update(true, null, null, null), admin.getId());
            jdbc.update("UPDATE system_job SET next_run_at = ? WHERE \"key\" = ?",
                    java.time.OffsetDateTime.parse("2020-01-01T00:00:00Z"), BlockingJob.KEY);
            long before = runs.count();
            int runsBefore = blocking.runs();
            blocking.arm();
            CyclicBarrier barrier = new CyclicBarrier(2);
            CompletableFuture<SystemJobRunner.Tick> tick = CompletableFuture.supplyAsync(() -> {
                await(barrier);
                return runner.tick();
            }, THREADS);
            CompletableFuture<Integer> api = CompletableFuture.supplyAsync(() -> {
                await(barrier);
                try {
                    return perform(post(one + "/run"), admin).andReturn().getResponse().getStatus();
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            }, THREADS);
            int apiStatus = api.join();
            SystemJobRunner.Tick scheduled = tick.join();
            assertThat(blocking.awaitStarted()).isTrue();
            assertThat(apiStatus == 202 ? 1 : 0).as("round %s: api %s, tick %s", round, apiStatus, scheduled.claimed())
                    .isEqualTo(1 - scheduled.claimed());
            assertThat(apiStatus).isIn(202, 409);
            blocking.release();
            scheduled.done().orTimeout(20, TimeUnit.SECONDS).join();
            awaitIdle(BlockingJob.KEY);
            assertThat(runs.count() - before).as("runs started in round %s", round).isEqualTo(1);
            assertThat(blocking.runs() - runsBefore).isEqualTo(1);
        }
        jobService.reset(BlockingJob.KEY, null);
    }

    private static void await(CyclicBarrier barrier) {
        try {
            barrier.await(10, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

}
