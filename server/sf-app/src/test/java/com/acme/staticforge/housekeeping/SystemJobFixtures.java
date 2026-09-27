package com.acme.staticforge.housekeeping;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * System job test support (M29.1.1): runners with their own node id, clock, properties and job set over the shared
 * test database (the application's runner doesn't tick in the {@code test} profile), unique job keys, row and run
 * access, and a crash helper. A runner only claims the jobs it was given, so tests don't see each other's jobs.
 */
@Component
public class SystemJobFixtures {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private final SystemJobRepository jobRows;
    private final SystemJobRunRepository runs;
    private final JdbcTemplate jdbc;
    private final PlatformTransactionManager transactionManager;

    public SystemJobFixtures(
            SystemJobRepository jobRows,
            SystemJobRunRepository runs,
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager) {
        this.jobRows = jobRows;
        this.runs = runs;
        this.jdbc = jdbc;
        this.transactionManager = transactionManager;
    }

    /** A key no other test uses: {@code t<n>-<name>}. */
    public static String key(String name) {
        return "t" + SEQ.incrementAndGet() + "-" + name;
    }

    public static HousekeepingProperties properties(String zone, int historyPerJob) {
        HousekeepingProperties properties = new HousekeepingProperties();
        properties.setZone(zone);
        properties.setHistoryPerJob(historyPerJob);
        return properties;
    }

    /** A runner as node {@code nodeId} on {@code clock} with {@code jobs}, seeded; lease 2 minutes. */
    public SystemJobRunner runner(String nodeId, Clock clock, HousekeepingProperties properties, HousekeepingJob... jobs) {
        SystemJobRunner runner = new SystemJobRunner(
                List.of(jobs),
                jobRows,
                runs,
                jdbc,
                transactionManager,
                new SimpleMeterRegistry(),
                properties,
                Duration.ofMinutes(2),
                nodeId,
                clock);
        runner.seed();
        return runner;
    }

    public SystemJobRunner runner(String nodeId, Clock clock, HousekeepingJob... jobs) {
        return runner(nodeId, clock, properties("UTC", 200), jobs);
    }

    /** One tick of {@code runner}, waited for; the number of jobs it claimed. */
    public int tickOnce(SystemJobRunner runner) {
        SystemJobRunner.Tick tick = runner.tick();
        tick.done().orTimeout(30, TimeUnit.SECONDS).join();
        return tick.claimed();
    }

    public SystemJob row(String key) {
        return jobRows.findById(key).orElseThrow();
    }

    public SystemJob save(SystemJob row) {
        return jobRows.saveAndFlush(row);
    }

    /** A job's runs, oldest first. */
    public List<SystemJobRun> runs(String key) {
        List<SystemJobRun> out = new ArrayList<>(
                runs.findByJobKeyOrderByStartedAtDescIdDesc(key, PageRequest.of(0, 1000)).getContent());
        Collections.reverse(out);
        return out;
    }

    /** Makes {@code key} due at {@code at}. */
    public void due(String key, Instant at) {
        jdbc.update("UPDATE system_job SET next_run_at = ? WHERE \"key\" = ?", utc(at), key);
    }

    /** Leaves {@code key} as a node that died mid-run would: leased by {@code node} until {@code until}, a run open. */
    public SystemJobRun crash(String key, String node, Instant startedAt, Instant until) {
        jdbc.update("UPDATE system_job SET lease_owner = ?, lease_until = ?, version = version + 1 WHERE \"key\" = ?",
                node, utc(until), key);
        return runs.saveAndFlush(new SystemJobRun(key, JobTrigger.SCHEDULE, false, startedAt, null));
    }

    public SystemJobRun run(long id) {
        return runs.findById(id).orElseThrow();
    }

    private static OffsetDateTime utc(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
