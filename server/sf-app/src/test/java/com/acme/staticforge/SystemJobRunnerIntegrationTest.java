package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.housekeeping.HousekeepingProperties;
import com.acme.staticforge.housekeeping.JobOutcome;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.ScriptedJob;
import com.acme.staticforge.housekeeping.SystemJob;
import com.acme.staticforge.housekeeping.SystemJobFixtures;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.scheduler.SchedulerEngine;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The system job runner (M29.1.1): seeding, exactly-once claiming across two runners, lease expiry, cron slots in a
 * zone across DST, missed slots, failures, history cap, startup runs, dry-run samples, shutdown and the scheduler poll
 * hook. Clocks are injected and moved by hand; runners are ticked directly. Every test uses job keys of its own.
 */
@SpringBootTest
@ActiveProfiles("test")
class SystemJobRunnerIntegrationTest {

    private static final Instant T = Instant.parse("2025-06-02T10:00:00Z");
    private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");

    @Autowired SystemJobFixtures fixtures;
    @Autowired SchedulerFixtures schedulerFixtures;

    // ------------------------------------------------------------------
    // Seeding
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the first start seeds the row from the defaults; an edited row survives a restart with other defaults")
    void seedingKeepsEditedRows() {
        String key = SystemJobFixtures.key("seed");
        MutableClock clock = new MutableClock(T);
        HousekeepingProperties berlin = SystemJobFixtures.properties("Europe/Berlin", 200);
        try (SystemJobRunner first = fixtures.runner("node-a", clock, berlin, ScriptedJob.of(key, "0 1 * * *").n(5))) {
            SystemJob row = fixtures.row(key);
            assertThat(row.isEnabled()).isTrue();
            assertThat(row.getCron()).isEqualTo("0 1 * * *");
            assertThat(row.getZoneId()).isEqualTo("Europe/Berlin");
            assertThat(row.getSettings().path("n").asInt()).isEqualTo(5);
            assertThat(row.getNextRunAt()).isEqualTo(Instant.parse("2025-06-02T23:00:00Z")); // 01:00 CEST
            assertThat(row.getLeaseOwner()).isNull();

            row.setCron("0 2 * * *");
            row.setEnabled(false);
            row.setSettings(JsonNodeFactory.instance.objectNode().put("n", 7));
            fixtures.save(row);
        }

        // "Restart" with different properties: the admin's row wins.
        ScriptedJob changed = ScriptedJob.of(key, "0 5 * * *").n(9);
        try (SystemJobRunner second = fixtures.runner("node-a", clock, SystemJobFixtures.properties("UTC", 200), changed)) {
            SystemJob row = fixtures.row(key);
            assertThat(row.getCron()).isEqualTo("0 2 * * *");
            assertThat(row.isEnabled()).isFalse();
            assertThat(row.getZoneId()).isEqualTo("Europe/Berlin");
            assertThat(row.getSettings().path("n").asInt()).isEqualTo(7);
        }

        // A runner without the job (its bean was removed) keeps the row and never runs it.
        fixtures.due(key, T.minusSeconds(60));
        try (SystemJobRunner without = fixtures.runner("node-a", clock, ScriptedJob.of(SystemJobFixtures.key("other"), "0 3 * * *"))) {
            assertThat(fixtures.tickOnce(without)).isZero();
            assertThat(fixtures.row(key).getCron()).isEqualTo("0 2 * * *");
            assertThat(fixtures.runs(key)).isEmpty();
        }
    }

    // ------------------------------------------------------------------
    // Claiming
    // ------------------------------------------------------------------

    @Test
    @DisplayName("two runners against one database never run a job concurrently, scheduled or by hand")
    void twoRunnersNeverOverlap() throws Exception {
        String key = SystemJobFixtures.key("pair");
        AtomicInteger active = new AtomicInteger();
        AtomicInteger maxActive = new AtomicInteger();
        ScriptedJob job = ScriptedJob.of(key, "* * * * *").body(ctx -> {
            int now = active.incrementAndGet();
            maxActive.accumulateAndGet(now, Math::max);
            try {
                Thread.sleep(150);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            active.decrementAndGet();
            return JobResult.succeeded();
        });
        MutableClock clock = new MutableClock(T);
        int started = 0;
        try (SystemJobRunner a = fixtures.runner("node-a", clock, job);
                SystemJobRunner b = fixtures.runner("node-b", clock, job);
                ExecutorService threads = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int round = 0; round < 10; round++) {
                clock.advance(Duration.ofMinutes(1));
                CyclicBarrier barrier = new CyclicBarrier(4);
                CompletableFuture<SystemJobRunner.Tick> ta = CompletableFuture.supplyAsync(() -> together(barrier, a::tick), threads);
                CompletableFuture<SystemJobRunner.Tick> tb = CompletableFuture.supplyAsync(() -> together(barrier, b::tick), threads);
                CompletableFuture<Optional<SystemJobRunner.Started>> ma = CompletableFuture.supplyAsync(() -> together(barrier, () -> a.start(key, JobTrigger.MANUAL, false, null)), threads);
                CompletableFuture<Optional<SystemJobRunner.Started>> mb = CompletableFuture.supplyAsync(() -> together(barrier, () -> b.start(key, JobTrigger.MANUAL, false, null)), threads);
                List<CompletableFuture<Void>> done = new ArrayList<>();
                int claimed = 0;
                for (SystemJobRunner.Tick tick : List.of(ta.join(), tb.join())) {
                    claimed += tick.claimed();
                    done.add(tick.done());
                }
                for (Optional<SystemJobRunner.Started> manual : List.of(ma.join(), mb.join())) {
                    if (manual.isPresent()) {
                        claimed++;
                        done.add(manual.get().done());
                    }
                }
                // Four contenders at once: the first claim wins, the others see the lease. A manual run keeps the
                // schedule, so a contender arriving after the run ended may start the job again — never alongside it.
                assertThat(claimed).as("claims in round %s", round).isBetween(1, 4);
                started += claimed;
                done.forEach(CompletableFuture::join);
            }
        }
        assertThat(maxActive.get()).isEqualTo(1);
        assertThat(job.runs()).hasSize(started);
        assertThat(fixtures.runs(key)).hasSize(started).allSatisfy(run -> assertThat(run.getOutcome()).isEqualTo(JobOutcome.SUCCEEDED));
        assertThat(fixtures.row(key).getLeaseOwner()).isNull();
    }

    @Test
    @DisplayName("a lease left by a crashed holder expires; the job runs again and the open run is recorded as failed")
    void crashedLeaseIsReclaimed() {
        String key = SystemJobFixtures.key("crash");
        ScriptedJob job = ScriptedJob.of(key, "0 3 * * *");
        MutableClock clock = new MutableClock(T);
        try (SystemJobRunner runner = fixtures.runner("node-a", clock, job)) {
            fixtures.due(key, T.minusSeconds(600));
            SystemJobRun open = fixtures.crash(key, "dead-node", T.minusSeconds(300), T.plusSeconds(60));

            assertThat(fixtures.tickOnce(runner)).as("lease still valid").isZero();
            assertThat(runner.start(key, JobTrigger.MANUAL, false, null)).as("manual run while held").isEmpty();

            clock.advance(Duration.ofSeconds(61));
            assertThat(fixtures.tickOnce(runner)).isEqualTo(1);
            assertThat(fixtures.tickOnce(runner)).isZero();

            SystemJobRun interrupted = fixtures.run(open.getId());
            assertThat(interrupted.getOutcome()).isEqualTo(JobOutcome.FAILED);
            assertThat(interrupted.getMessage()).startsWith("Interrupted");
            assertThat(interrupted.getFinishedAt()).isNotNull();
        }
        assertThat(job.runs()).hasSize(1);
        assertThat(fixtures.runs(key)).last().satisfies(run -> assertThat(run.getOutcome()).isEqualTo(JobOutcome.SUCCEEDED));
        SystemJob row = fixtures.row(key);
        assertThat(row.getLeaseOwner()).isNull();
        assertThat(row.getNextRunAt()).isEqualTo(Instant.parse("2025-06-03T03:00:00Z"));
    }

    // ------------------------------------------------------------------
    // Cron slots
    // ------------------------------------------------------------------

    @Test
    @DisplayName("0 3 * * * in Europe/Berlin runs once a day at 03:00 local across both DST changes")
    void cronInZoneAcrossDst() {
        assertDailyAtThreeAcross(LocalDate.of(2025, 3, 28), LocalDate.of(2025, 4, 2)); // spring forward on 30 March
        assertDailyAtThreeAcross(LocalDate.of(2025, 10, 24), LocalDate.of(2025, 10, 29)); // fall back on 26 October
    }

    private void assertDailyAtThreeAcross(LocalDate from, LocalDate to) {
        String key = SystemJobFixtures.key("dst");
        ScriptedJob job = ScriptedJob.of(key, "0 3 * * *");
        Instant start = from.atStartOfDay(BERLIN).toInstant();
        Instant end = to.atStartOfDay(BERLIN).toInstant();
        MutableClock clock = new MutableClock(start);
        try (SystemJobRunner runner = fixtures.runner("node-a", clock, SystemJobFixtures.properties("Europe/Berlin", 200), job)) {
            while (clock.instant().isBefore(end)) {
                clock.advance(Duration.ofMinutes(20));
                fixtures.tickOnce(runner);
            }
        }
        Map<LocalDate, List<LocalTime>> byDay = new TreeMap<>();
        job.runs().forEach(run -> {
            ZonedDateTime local = run.at().atZone(BERLIN);
            byDay.computeIfAbsent(local.toLocalDate(), d -> new ArrayList<>()).add(local.toLocalTime());
        });
        assertThat(byDay).hasSize((int) (to.toEpochDay() - from.toEpochDay()));
        byDay.forEach((day, times) -> assertThat(times).as("runs on %s", day).singleElement()
                .satisfies(time -> assertThat(time).isBetween(LocalTime.of(3, 0), LocalTime.of(3, 20))));
    }

    @Test
    @DisplayName("slots missed while down run once, and the next slot is the first after now")
    void missedSlotsRunOnce() {
        String key = SystemJobFixtures.key("missed");
        ScriptedJob job = ScriptedJob.of(key, "0 3 * * *");
        MutableClock clock = new MutableClock(T);
        try (SystemJobRunner runner = fixtures.runner("node-a", clock, job)) {
            assertThat(fixtures.row(key).getNextRunAt()).isEqualTo(Instant.parse("2025-06-03T03:00:00Z"));
            clock.set(Instant.parse("2025-06-06T12:00:00Z"));
            assertThat(fixtures.tickOnce(runner)).isEqualTo(1);
            assertThat(fixtures.tickOnce(runner)).isZero();
        }
        assertThat(job.runs()).singleElement().satisfies(run -> assertThat(run.trigger()).isEqualTo(JobTrigger.SCHEDULE));
        assertThat(fixtures.row(key).getNextRunAt()).isEqualTo(Instant.parse("2025-06-07T03:00:00Z"));
    }

    // ------------------------------------------------------------------
    // Outcomes and history
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a failing job records FAILED with message and stack digest, and still runs at its next slot")
    void failureIsRecordedAndNextRunHappens() {
        String key = SystemJobFixtures.key("fail");
        ScriptedJob job = ScriptedJob.of(key, "0 3 * * *").body(ctx -> {
            throw new IllegalStateException("disk on fire");
        });
        MutableClock clock = new MutableClock(Instant.parse("2025-06-03T03:00:30Z"));
        try (SystemJobRunner runner = fixtures.runner("node-a", clock, job)) {
            fixtures.due(key, Instant.parse("2025-06-03T03:00:00Z"));
            assertThat(fixtures.tickOnce(runner)).isEqualTo(1);
            SystemJob row = fixtures.row(key);
            assertThat(row.getLeaseOwner()).isNull();
            assertThat(row.getNextRunAt()).isEqualTo(Instant.parse("2025-06-04T03:00:00Z"));

            clock.set(Instant.parse("2025-06-04T03:00:10Z"));
            assertThat(fixtures.tickOnce(runner)).isEqualTo(1);
        }
        List<SystemJobRun> runs = fixtures.runs(key);
        assertThat(runs).hasSize(2).allSatisfy(run -> {
            assertThat(run.getOutcome()).isEqualTo(JobOutcome.FAILED);
            assertThat(run.getMessage()).isEqualTo("Failed: IllegalStateException: disk on fire");
            assertThat(run.getReport().path("error").path("stackTrace").asText())
                    .startsWith("java.lang.IllegalStateException: disk on fire")
                    .contains("SystemJobRunnerIntegrationTest");
        });
        assertThat(fixtures.row(key).getLastRunId()).isEqualTo(runs.get(1).getId());
    }

    @Test
    @DisplayName("the history keeps the newest history-per-job runs")
    void historyIsCapped() {
        String key = SystemJobFixtures.key("cap");
        ScriptedJob job = ScriptedJob.of(key, "* * * * *");
        MutableClock clock = new MutableClock(T);
        try (SystemJobRunner runner = fixtures.runner("node-a", clock, SystemJobFixtures.properties("UTC", 3), job)) {
            for (int i = 0; i < 5; i++) {
                clock.advance(Duration.ofMinutes(1));
                assertThat(fixtures.tickOnce(runner)).isEqualTo(1);
            }
        }
        assertThat(job.runs()).hasSize(5);
        List<SystemJobRun> kept = fixtures.runs(key);
        assertThat(kept).hasSize(3);
        assertThat(kept.get(0).getStartedAt()).isEqualTo(T.plus(Duration.ofMinutes(3)));
    }

    @Test
    @DisplayName("startup runs an enabled runOnStartup job once as STARTUP; a disabled one stays put")
    void startupRuns() {
        ScriptedJob startup = ScriptedJob.of(SystemJobFixtures.key("boot"), "*/5 * * * *").onStartup();
        ScriptedJob disabled = ScriptedJob.of(SystemJobFixtures.key("boot-off"), "*/5 * * * *").onStartup().enabled(false);
        ScriptedJob plain = ScriptedJob.of(SystemJobFixtures.key("plain"), "*/5 * * * *");
        MutableClock clock = new MutableClock(T);
        try (SystemJobRunner runner = fixtures.runner("node-a", clock, startup, disabled, plain)) {
            SystemJobRunner.Tick tick = runner.runStartupJobs();
            tick.done().join();
            assertThat(tick.claimed()).isEqualTo(1);
        }
        assertThat(startup.runs()).singleElement().satisfies(run -> assertThat(run.trigger()).isEqualTo(JobTrigger.STARTUP));
        assertThat(disabled.runs()).isEmpty();
        assertThat(plain.runs()).isEmpty();
        assertThat(fixtures.row(startup.key()).getNextRunAt()).as("schedule unchanged").isEqualTo(T.plus(Duration.ofMinutes(5)));
    }

    @Test
    @DisplayName("a dry run passes the flag, settings and a sample bounded at 50 with the total")
    void dryRunSample() {
        String key = SystemJobFixtures.key("dry");
        ScriptedJob job = ScriptedJob.of(key, "0 3 * * *").n(12).body(ctx -> {
            for (int i = 0; i < 120; i++) {
                ctx.examined(1);
                ctx.sample("blob-" + i);
                ctx.affected(1);
                ctx.bytesFreed(1024);
            }
            ctx.report().putArray("projects").addObject().put("key", "demo").put("affected", 120);
            return null;
        });
        MutableClock clock = new MutableClock(T);
        SystemJobRun run;
        try (SystemJobRunner runner = fixtures.runner("node-a", clock, job)) {
            SystemJobRunner.Started started = runner.start(key, JobTrigger.MANUAL, true, null).orElseThrow();
            started.done().join();
            run = fixtures.run(started.run().getId());
        }
        assertThat(job.runs()).singleElement().satisfies(r -> {
            assertThat(r.dryRun()).isTrue();
            assertThat(r.n()).isEqualTo(12);
        });
        assertThat(run.isDryRun()).isTrue();
        assertThat(run.getTrigger()).isEqualTo(JobTrigger.MANUAL);
        assertThat(run.getOutcome()).isEqualTo(JobOutcome.SUCCEEDED);
        assertThat(run.getItemsAffected()).isEqualTo(120);
        assertThat(run.getBytesFreed()).isEqualTo(120 * 1024);
        assertThat(run.getMessage()).isEqualTo("Dry run: examined 120, would affect 120, would free 120.0 KB.");
        assertThat(run.getReport().path("sample")).hasSize(50);
        assertThat(run.getReport().path("sample").get(0).asText()).isEqualTo("blob-0");
        assertThat(run.getReport().path("sampleTotal").asInt()).isEqualTo(120);
        assertThat(run.getReport().path("projects").get(0).path("affected").asInt()).isEqualTo(120);
        assertThat(fixtures.row(key).getNextRunAt()).as("a manual run keeps the schedule")
                .isEqualTo(Instant.parse("2025-06-03T03:00:00Z"));
    }

    @Test
    @DisplayName("shutting down cancels a running job, records the run and releases the lease")
    void shutdownCancels() throws Exception {
        String key = SystemJobFixtures.key("stop");
        CountDownLatch running = new CountDownLatch(1);
        ScriptedJob job = ScriptedJob.of(key, "0 3 * * *").body(ctx -> {
            running.countDown();
            while (true) {
                ctx.checkCancelled();
                try {
                    Thread.sleep(20);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return JobResult.failed("interrupted");
                }
            }
        });
        MutableClock clock = new MutableClock(T);
        SystemJobRunner runner = fixtures.runner("node-a", clock, job);
        SystemJobRunner.Started started = runner.start(key, JobTrigger.MANUAL, false, null).orElseThrow();
        assertThat(running.await(10, TimeUnit.SECONDS)).isTrue();
        assertThat(fixtures.row(key).getLeaseOwner()).isEqualTo("node-a");
        runner.close();
        SystemJobRun run = fixtures.run(started.run().getId());
        assertThat(run.getOutcome()).isEqualTo(JobOutcome.FAILED);
        assertThat(run.getMessage()).isEqualTo("Cancelled: the node is shutting down");
        assertThat(fixtures.row(key).getLeaseOwner()).isNull();
    }

    // ------------------------------------------------------------------
    // Scheduler hook
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a scheduler poll runs every tick participant; a failing one doesn't stop the others")
    void pollRunsTickParticipants() {
        AtomicInteger calls = new AtomicInteger();
        SchedulerEngine engine = schedulerFixtures.engine("node-hook", new MutableClock(T));
        try {
            engine.addTickParticipant(() -> {
                throw new IllegalStateException("broken participant");
            });
            engine.addTickParticipant(calls::incrementAndGet);
            engine.poll();
            engine.poll();
        } finally {
            engine.close();
        }
        assertThat(calls.get()).isEqualTo(2);
    }

    private static <T> T together(CyclicBarrier barrier, java.util.function.Supplier<T> action) {
        try {
            barrier.await(10, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return action.get();
    }
}
