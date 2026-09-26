package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.project.publish.PublishRequirements;
import com.acme.staticforge.scheduler.ActionSpec;
import com.acme.staticforge.scheduler.ActionStatus;
import com.acme.staticforge.scheduler.ExecutionContext;
import com.acme.staticforge.scheduler.ExecutionOutcome;
import com.acme.staticforge.scheduler.ExecutionResult;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.ScheduledActionExecution;
import com.acme.staticforge.scheduler.ScheduledActionHandler;
import com.acme.staticforge.scheduler.SchedulerEngine;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The scheduler engine (M27.4.1): exactly-once claiming across nodes, lease expiry, missed policy, cron slots in a
 * zone across DST, owner re-check and archived projects. Clocks are injected and moved by hand; engines are ticked
 * directly. Clocks run in 2025 so the engines never claim what other test classes schedule.
 */
@SpringBootTest
@ActiveProfiles("test")
class SchedulerEngineIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final Instant T = Instant.parse("2025-06-02T10:00:00Z");
    private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");

    @Autowired SchedulerFixtures fixtures;
    @Autowired UserService userService;
    @Autowired AppUserRepository users;
    @Autowired ProjectService projectService;
    @Autowired AuditService auditService;

    private final List<Long> projects = new ArrayList<>();

    /** Counts executions per action; always succeeds. */
    static final class CountingHandler implements ScheduledActionHandler {

        static final String TYPE = "TEST_COUNT";
        final Map<Long, AtomicInteger> counts = new ConcurrentHashMap<>();

        @Override
        public String type() {
            return TYPE;
        }

        @Override
        public Timing timing() {
            return Timing.ONE_OFF;
        }

        @Override
        public ActionSpec validate(ActionSpec draft, long actorUserId) {
            return draft;
        }

        @Override
        public PublishRequirements requirements(ActionSpec spec) {
            return PublishRequirements.role(ProjectRole.DEVELOPER);
        }

        @Override
        public ExecutionResult execute(ExecutionContext ctx) {
            counts.computeIfAbsent(ctx.actionId(), id -> new AtomicInteger()).incrementAndGet();
            return ExecutionResult.succeeded("counted", null);
        }

        int count(ScheduledAction action) {
            AtomicInteger count = counts.get(action.getId());
            return count == null ? 0 : count.get();
        }
    }

    private record Fixture(Project project, AppUser admin, AppUser owner) {
        long id() {
            return project.getId();
        }
    }

    @AfterEach
    void retire() {
        projects.forEach(fixtures::retire);
    }

    // ------------------------------------------------------------------
    // Claiming
    // ------------------------------------------------------------------

    @Test
    @DisplayName("two engines against one database execute each of 50 due actions exactly once")
    void twoNodesExecuteEachActionOnce() throws Exception {
        Fixture fx = fixture("sch-nodes");
        CountingHandler counter = new CountingHandler();
        MutableClock clock = new MutableClock(T);
        List<ScheduledAction> due = new ArrayList<>();
        for (int i = 0; i < 50; i++) {
            due.add(fixtures.oneOff(fx.id(), CountingHandler.TYPE, params(), T.minusSeconds(i), fx.owner().getId()));
        }
        SchedulerEngine a = fixtures.engine("node-a", clock, counter);
        SchedulerEngine b = fixtures.engine("node-b", clock, counter);
        try {
            for (int round = 0; round < 10; round++) {
                CyclicBarrier start = new CyclicBarrier(2);
                CompletableFuture<SchedulerEngine.Tick> ta = CompletableFuture.supplyAsync(() -> tickTogether(a, start));
                CompletableFuture<SchedulerEngine.Tick> tb = CompletableFuture.supplyAsync(() -> tickTogether(b, start));
                SchedulerEngine.Tick first = ta.join();
                SchedulerEngine.Tick second = tb.join();
                first.done().join();
                second.done().join();
                if (first.claimed() + second.claimed() == 0) {
                    break;
                }
            }
        } finally {
            a.close();
            b.close();
        }

        for (ScheduledAction action : due) {
            assertThat(counter.count(action)).as("executions of action %s", action.getId()).isEqualTo(1);
            ScheduledAction after = fixtures.reload(action.getId());
            assertThat(after.getStatus()).isEqualTo(ActionStatus.SUCCEEDED);
            assertThat(after.getNextRunAt()).isNull();
            assertThat(after.getLeaseOwner()).isNull();
            assertThat(fixtures.executions(action.getId())).singleElement()
                    .satisfies(e -> assertThat(e.getOutcome()).isEqualTo(ExecutionOutcome.SUCCEEDED));
        }
        List<AuditLog> audit = auditService.findRecent(fx.id(), PageRequest.of(0, 200));
        assertThat(audit).filteredOn(e -> e.getAction().equals("SCHEDULE_EXECUTED")).hasSize(50);
    }

    @Test
    @DisplayName("a lease left by a crashed node is claimed again once it expired, and executed once")
    void crashedLeaseIsReclaimed() {
        Fixture fx = fixture("sch-crash");
        CountingHandler counter = new CountingHandler();
        MutableClock clock = new MutableClock(T);
        ScheduledAction crashed = fixtures.oneOff(fx.id(), CountingHandler.TYPE, params(), T.minusSeconds(600), fx.owner().getId());
        fixtures.crash(crashed.getId(), "dead-node", T.plusSeconds(60));
        SchedulerEngine engine = fixtures.engine("node-a", clock, counter);
        try {
            assertThat(fixtures.drain(engine)).as("lease still valid").isZero();
            clock.advance(Duration.ofSeconds(61));
            assertThat(fixtures.drain(engine)).isEqualTo(1);
            assertThat(fixtures.drain(engine)).isZero();
        } finally {
            engine.close();
        }
        assertThat(counter.count(crashed)).isEqualTo(1);
        assertThat(fixtures.reload(crashed.getId()).getStatus()).isEqualTo(ActionStatus.SUCCEEDED);
    }

    // ------------------------------------------------------------------
    // Missed policy
    // ------------------------------------------------------------------

    @Test
    @DisplayName("RUN_LATE records how late it ran; SKIP_IF_LATER_THAN 10m at 30 min late is skipped")
    void missedPolicy() {
        Fixture fx = fixture("sch-late");
        CountingHandler counter = new CountingHandler();
        MutableClock clock = new MutableClock(T.plus(Duration.ofMinutes(30)));
        ScheduledAction late = fixtures.oneOff(fx.id(), CountingHandler.TYPE, params(), T, fx.owner().getId());
        ScheduledAction skipped = fixtures.skipIfLaterThan(
                fixtures.oneOff(fx.id(), CountingHandler.TYPE, params(), T, fx.owner().getId()), Duration.ofMinutes(10));
        ScheduledAction inTime = fixtures.skipIfLaterThan(
                fixtures.oneOff(fx.id(), CountingHandler.TYPE, params(), T.plus(Duration.ofMinutes(25)), fx.owner().getId()),
                Duration.ofMinutes(10));
        SchedulerEngine engine = fixtures.engine("node-a", clock, counter);
        try {
            assertThat(fixtures.drain(engine)).isEqualTo(3);
        } finally {
            engine.close();
        }

        assertThat(counter.count(late)).isEqualTo(1);
        assertThat(fixtures.executions(late.getId())).singleElement().satisfies(e -> {
            assertThat(e.getLateByMs()).isEqualTo(Duration.ofMinutes(30).toMillis());
            assertThat(e.getScheduledFor()).isEqualTo(T);
        });
        assertThat(counter.count(skipped)).isZero();
        assertThat(fixtures.reload(skipped.getId()).getStatus()).isEqualTo(ActionStatus.SKIPPED);
        assertThat(fixtures.executions(skipped.getId())).singleElement().satisfies(e -> {
            assertThat(e.getOutcome()).isEqualTo(ExecutionOutcome.SKIPPED);
            assertThat(e.getMessage()).contains("30m late").contains("10m");
        });
        assertThat(counter.count(inTime)).isEqualTo(1);
        assertThat(auditService.findRecent(fx.id(), PageRequest.of(0, 50)))
                .extracting(AuditLog::getAction)
                .contains("SCHEDULE_EXECUTED", "SCHEDULE_SKIPPED");
    }

    @Test
    @DisplayName("an hourly schedule down for 5 h executes once for the missed slots, then at the next slot")
    void missedRecurringSlotsCollapse() {
        Fixture fx = fixture("sch-down");
        CountingHandler counter = new CountingHandler();
        ScheduledAction hourly = fixtures.recurring(
                fx.id(), CountingHandler.TYPE, params(), "0 0 * * * *", "UTC", T.minusSeconds(1), fx.owner().getId());
        assertThat(hourly.getNextRunAt()).isEqualTo(T);
        MutableClock clock = new MutableClock(T.plus(Duration.ofHours(5)).plusSeconds(600));
        SchedulerEngine engine = fixtures.engine("node-a", clock, counter);
        try {
            assertThat(fixtures.drain(engine)).isEqualTo(1);
            ScheduledAction after = fixtures.reload(hourly.getId());
            assertThat(after.getStatus()).isEqualTo(ActionStatus.PENDING);
            assertThat(after.getNextRunAt()).isEqualTo(T.plus(Duration.ofHours(6)));
            assertThat(fixtures.drain(engine)).isZero();

            clock.set(T.plus(Duration.ofHours(6)));
            assertThat(fixtures.drain(engine)).isEqualTo(1);
            assertThat(fixtures.reload(hourly.getId()).getNextRunAt()).isEqualTo(T.plus(Duration.ofHours(7)));
        } finally {
            engine.close();
        }
        assertThat(counter.count(hourly)).isEqualTo(2);
        assertThat(fixtures.executions(hourly.getId())).extracting(ScheduledActionExecution::getScheduledFor)
                .containsExactly(T, T.plus(Duration.ofHours(6)));
    }

    // ------------------------------------------------------------------
    // Time zones
    // ------------------------------------------------------------------

    @Test
    @DisplayName("cron 0 30 2 * * * in Europe/Berlin runs once at 03:00 on the spring-forward day and once on the fall-back day")
    void cronAcrossDst() {
        Fixture fx = fixture("sch-dst");
        CountingHandler counter = new CountingHandler();
        // 2025-03-30: 02:00 → 03:00 (02:30 doesn't exist). 2025-10-26: 03:00 → 02:00 (02:30 exists twice).
        Instant springEve = LocalDateTime.of(2025, 3, 29, 12, 0).atZone(BERLIN).toInstant();
        ScheduledAction nightly = fixtures.recurring(
                fx.id(), CountingHandler.TYPE, params(), "0 30 2 * * *", BERLIN.getId(), springEve, fx.owner().getId());
        Instant spring = Instant.parse("2025-03-30T01:00:00Z");
        assertThat(nightly.getNextRunAt()).isEqualTo(spring);
        assertThat(spring.atZone(BERLIN).toLocalDateTime()).isEqualTo(LocalDateTime.of(2025, 3, 30, 3, 0));

        MutableClock clock = new MutableClock(spring.minusSeconds(1));
        SchedulerEngine engine = fixtures.engine("node-a", clock, counter);
        try {
            assertThat(fixtures.drain(engine)).isZero();
            clock.set(spring.plusSeconds(5));
            assertThat(fixtures.drain(engine)).isEqualTo(1);
            assertThat(fixtures.reload(nightly.getId()).getNextRunAt()).isEqualTo(Instant.parse("2025-03-31T00:30:00Z"));

            // Autumn: the first 02:30 (CEST) runs, the repeated 02:30 (CET) doesn't.
            nightly = fixtures.reload(nightly.getId());
            nightly.setNextRunAt(Instant.parse("2025-10-26T00:30:00Z"));
            nightly = fixtures.save(nightly);
            clock.set(Instant.parse("2025-10-26T00:30:05Z"));
            assertThat(fixtures.drain(engine)).isEqualTo(1);
            assertThat(fixtures.reload(nightly.getId()).getNextRunAt()).isEqualTo(Instant.parse("2025-10-27T01:30:00Z"));
            clock.set(Instant.parse("2025-10-26T01:30:05Z"));
            assertThat(fixtures.drain(engine)).isZero();
        } finally {
            engine.close();
        }
        assertThat(counter.count(nightly)).isEqualTo(2);
    }

    // ------------------------------------------------------------------
    // Authority and archived projects
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an owner who was disabled, removed or demoted fails the execution with SF-DOM-0163; recurring actions pause")
    void ownerNoLongerPermitted() {
        Fixture disabled = fixture("sch-dis");
        Fixture removed = fixture("sch-rem");
        Fixture demoted = fixture("sch-dem");
        Fixture locked = fixture("sch-lock");
        CountingHandler counter = new CountingHandler();
        ScheduledAction oneOff = fixtures.oneOff(disabled.id(), CountingHandler.TYPE, params(), T, disabled.owner().getId());
        ScheduledAction recurring = fixtures.recurring(
                removed.id(), CountingHandler.TYPE, params(), "0 0 * * * *", "UTC", T.minusSeconds(1), removed.owner().getId());
        ScheduledAction demotedAction = fixtures.oneOff(demoted.id(), CountingHandler.TYPE, params(), T, demoted.owner().getId());
        ScheduledAction lockedAction = fixtures.oneOff(locked.id(), CountingHandler.TYPE, params(), T, locked.owner().getId());

        setStatus(disabled.owner(), UserStatus.DISABLED);
        projectService.removeMember(removed.project().getKey(), removed.owner().getId(), ctx(removed));
        projectService.setMemberRole(demoted.project().getKey(), demoted.owner().getId(), ProjectRole.EDITOR, ctx(demoted));
        setStatus(locked.owner(), UserStatus.LOCKED);

        MutableClock clock = new MutableClock(T.plusSeconds(1));
        SchedulerEngine engine = fixtures.engine("node-a", clock, counter);
        try {
            assertThat(fixtures.drain(engine)).isEqualTo(4);
        } finally {
            engine.close();
        }

        for (ScheduledAction action : List.of(oneOff, recurring, demotedAction)) {
            assertThat(counter.count(action)).isZero();
            ScheduledAction after = fixtures.reload(action.getId());
            assertThat(after.getStatus()).isEqualTo(ActionStatus.FAILED);
            assertThat(after.getNextRunAt()).as("paused").isNull();
            assertThat(fixtures.executions(action.getId())).singleElement().satisfies(e -> {
                assertThat(e.getOutcome()).isEqualTo(ExecutionOutcome.FAILED);
                assertThat(e.getDetail().path("code").asText()).isEqualTo("SF-DOM-0163");
                assertThat(e.getMessage()).startsWith("Owner no longer permitted");
            });
        }
        assertThat(fixtures.executions(oneOff.getId()).get(0).getMessage()).contains("disabled");
        assertThat(fixtures.executions(recurring.getId()).get(0).getMessage()).contains("no longer a member");
        assertThat(fixtures.executions(demotedAction.getId()).get(0).getMessage()).contains("EDITOR");
        // A sign-in lockout is temporary and doesn't stop the owner's schedules.
        assertThat(counter.count(lockedAction)).isEqualTo(1);
        assertThat(auditService.findRecent(disabled.id(), PageRequest.of(0, 20)))
                .extracting(AuditLog::getAction).contains("SCHEDULE_FAILED");
    }

    @Test
    @DisplayName("an unknown type fails once with SF-DOM-0160 and is paused")
    void unknownType() {
        Fixture fx = fixture("sch-unknown");
        ScheduledAction action = fixtures.recurring(
                fx.id(), "NO_SUCH_TYPE", params(), "0 0 * * * *", "UTC", T.minusSeconds(1), fx.owner().getId());
        SchedulerEngine engine = fixtures.engine("node-a", new MutableClock(T.plusSeconds(1)));
        try {
            assertThat(fixtures.drain(engine)).isEqualTo(1);
            assertThat(fixtures.drain(engine)).isZero();
        } finally {
            engine.close();
        }
        ScheduledAction after = fixtures.reload(action.getId());
        assertThat(after.getStatus()).isEqualTo(ActionStatus.FAILED);
        assertThat(after.getNextRunAt()).isNull();
        assertThat(fixtures.executions(action.getId())).singleElement()
                .satisfies(e -> assertThat(e.getDetail().path("code").asText()).isEqualTo("SF-DOM-0160"));
    }

    @Test
    @DisplayName("an archived project executes nothing; after unarchiving, the missed policy decides")
    void archivedProjects() {
        Fixture fx = fixture("sch-arch");
        CountingHandler counter = new CountingHandler();
        ScheduledAction runLate = fixtures.oneOff(fx.id(), CountingHandler.TYPE, params(), T, fx.owner().getId());
        ScheduledAction bounded = fixtures.skipIfLaterThan(
                fixtures.oneOff(fx.id(), CountingHandler.TYPE, params(), T, fx.owner().getId()), Duration.ofMinutes(10));
        projectService.archive(fx.project().getKey(), ctx(fx));

        MutableClock clock = new MutableClock(T.plusSeconds(60));
        SchedulerEngine engine = fixtures.engine("node-a", clock, counter);
        try {
            assertThat(fixtures.drain(engine)).isZero();
            clock.advance(Duration.ofHours(1));
            projectService.unarchive(fx.project().getKey(), ctx(fx));
            assertThat(fixtures.drain(engine)).isEqualTo(2);
        } finally {
            engine.close();
        }
        assertThat(counter.count(runLate)).isEqualTo(1);
        assertThat(fixtures.executions(runLate.getId()).get(0).getLateByMs()).isEqualTo(Duration.ofSeconds(3660).toMillis());
        assertThat(counter.count(bounded)).isZero();
        assertThat(fixtures.reload(bounded.getId()).getStatus()).isEqualTo(ActionStatus.SKIPPED);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static SchedulerEngine.Tick tickTogether(SchedulerEngine engine, CyclicBarrier start) {
        try {
            start.await();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return engine.tick();
    }

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(prefix + n + "-admin", prefix + n + "-admin@example.com", "Admin", "secret-password");
        AppUser owner = userService.create(prefix + n + "-owner", prefix + n + "-owner@example.com", "Owner", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "scheduler"), admin.getId());
        projectService.setMemberRole(project.getKey(), owner.getId(), ProjectRole.DEVELOPER,
                RevisionContext.of(project.getId(), admin.getId(), "member"));
        projects.add(project.getId());
        return new Fixture(project, admin, owner);
    }

    private static RevisionContext ctx(Fixture fx) {
        return RevisionContext.of(fx.id(), fx.admin().getId(), "scheduler test");
    }

    private void setStatus(AppUser user, UserStatus status) {
        AppUser stored = users.findById(user.getId()).orElseThrow();
        stored.setStatus(status);
        users.save(stored);
    }

    private static com.fasterxml.jackson.databind.JsonNode params() {
        return JsonNodeFactory.instance.objectNode();
    }
}
