package com.acme.staticforge.housekeeping;

import com.acme.staticforge.common.SfException;
import com.acme.staticforge.scheduler.LeaseClaimer;
import com.acme.staticforge.scheduler.ScheduleTiming;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Runs the system jobs of one node (M29.1.1, epic decisions 1–2, 6). On every scheduler poll ({@link #tick()}, called
 * from the {@link com.acme.staticforge.scheduler.SchedulerEngine}'s tick) it claims each due, enabled job with the
 * same lease primitive as scheduled actions ({@link LeaseClaimer} on {@code system_job}) and runs it on a virtual
 * thread; manual runs ({@link #start}) and startup runs ({@link #runStartupJobs()}) claim the same lease, so a job
 * runs at most once at a time on any node. While a job runs its lease is renewed every half lease; a node that dies
 * leaves a lease that expires, after which the job is claimed again and the run the dead node left open is recorded
 * as {@code FAILED}.
 *
 * <p>Per run it writes a {@code system_job_run} row when the run starts and completes it when the run ends, then
 * computes the next slot of a scheduled run from the job's cron and zone <em>after now</em> — slots missed while the
 * system was down collapse into one run. A throwing job records {@code FAILED} with a stack-trace digest and never
 * affects the tick. After each run the job's history is capped at {@code sf.housekeeping.history-per-job}.
 *
 * <p>Metrics: {@code sf.job.duration{job,outcome}}, {@code sf.job.items{job,kind=examined|affected}},
 * {@code sf.job.bytes.freed{job}} (dry runs record only their duration) and the gauge
 * {@code sf.job.last.success.age{job}} in seconds since the newest successful non-dry run ({@code NaN} before the
 * first), read from the database so every node reports the same age.
 *
 * <p>A plain class rather than a component so tests can run several runners (node ids, clocks, job sets) against one
 * database; {@link HousekeepingConfiguration} makes the application's instance. All time comes from the injected
 * {@link Clock}.
 */
public class SystemJobRunner implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(SystemJobRunner.class);
    private static final Pattern KEY = Pattern.compile("[a-z0-9]+(-[a-z0-9]+)*");
    private static final int MAX_KEY = 64;
    private static final int CLAIM_ATTEMPTS = 3;
    private static final int FINISH_ATTEMPTS = 5;
    private static final String INTERRUPTED =
            "Interrupted: the node running it stopped or lost its lease before the run ended.";

    private final Map<String, HousekeepingJob> jobs;
    private final SystemJobRepository jobRows;
    private final SystemJobRunRepository runs;
    private final LeaseClaimer claimer;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final TransactionTemplate batchTx;
    private final MeterRegistry meters;
    private final HousekeepingProperties properties;
    private final Duration lease;
    private final String nodeId;
    private final Clock clock;

    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final ScheduledExecutorService leaseKeeper = Executors.newSingleThreadScheduledExecutor(
            Thread.ofPlatform().name("sf-housekeeping-lease").daemon().factory());
    private final Map<String, Execution> running = new ConcurrentHashMap<>();
    private volatile boolean closing;

    /** One tick: how many jobs this node claimed, and a future completing when they have all finished. */
    public record Tick(int claimed, CompletableFuture<Void> done) {}

    /** A run this node claimed and started: its row (as written at the start) and a future completing when it ends. */
    public record Started(SystemJobRun run, CompletableFuture<Void> done) {}

    public SystemJobRunner(
            Collection<? extends HousekeepingJob> jobs,
            SystemJobRepository jobRows,
            SystemJobRunRepository runs,
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager,
            MeterRegistry meters,
            HousekeepingProperties properties,
            Duration lease,
            String nodeId,
            Clock clock) {
        ZoneId.of(properties.getZone());
        Map<String, HousekeepingJob> byKey = new TreeMap<>();
        for (HousekeepingJob job : jobs) {
            check(job);
            if (byKey.putIfAbsent(job.key(), job) != null) {
                throw new IllegalStateException("Two housekeeping jobs have the key '" + job.key() + "'");
            }
        }
        this.jobs = Collections.unmodifiableMap(byKey);
        this.jobRows = jobRows;
        this.runs = runs;
        this.claimer = claimer(jdbc);
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(transactionManager);
        this.batchTx = new TransactionTemplate(transactionManager);
        this.batchTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.meters = meters;
        this.properties = properties;
        this.lease = lease;
        this.nodeId = nodeId;
        this.clock = clock;
        for (String key : this.jobs.keySet()) {
            Counter.builder("sf.job.items").description("Items system jobs examined or affected")
                    .tag("job", key).tag("kind", "examined").register(meters);
            Counter.builder("sf.job.items").description("Items system jobs examined or affected")
                    .tag("job", key).tag("kind", "affected").register(meters);
            Counter.builder("sf.job.bytes.freed").description("Storage system jobs freed, in bytes")
                    .tag("job", key).register(meters);
            Gauge.builder("sf.job.last.success.age", this, runner -> runner.lastSuccessAgeSeconds(key))
                    .description("Seconds since the job's newest successful run (NaN before the first)")
                    .baseUnit("seconds")
                    .tag("job", key)
                    .strongReference(true)
                    .register(meters);
        }
    }

    /** The claimer of {@code system_job} rows, keyed by their quoted {@code "key"} column. */
    public static LeaseClaimer claimer(JdbcTemplate jdbc) {
        return new LeaseClaimer(jdbc, "system_job", "\"key\"", null);
    }

    public String nodeId() {
        return nodeId;
    }

    /** The jobs this runner knows, by key. */
    public Map<String, HousekeepingJob> jobs() {
        return jobs;
    }

    public Optional<HousekeepingJob> job(String key) {
        return Optional.ofNullable(key == null ? null : jobs.get(key));
    }

    /**
     * The settings a run of {@code job} uses: each key of its defaults, with the stored value where the row has one.
     * A key a newer version of the job added works before the admin saves it; a key it dropped is ignored.
     */
    public static ObjectNode effectiveSettings(HousekeepingJob job, JsonNode stored) {
        ObjectNode effective = job.defaults().settings();
        if (stored != null && stored.isObject()) {
            effective.fieldNames().forEachRemaining(name -> {
                JsonNode value = stored.get(name);
                if (value != null && !value.isNull()) {
                    effective.set(name, value.deepCopy());
                }
            });
        }
        return effective;
    }

    /** When a job with {@code cron} in {@code zoneId} is next due after {@code after}; {@code null} when disabled. */
    public static Instant nextRun(boolean enabled, String cron, String zoneId, Instant after) {
        return enabled ? ScheduleTiming.nextAfter(cron, ZoneId.of(zoneId), after) : null;
    }

    // ------------------------------------------------------------------
    // Seeding
    // ------------------------------------------------------------------

    /**
     * Inserts the missing {@code system_job} rows from each job's defaults and {@code sf.housekeeping.zone}. Existing
     * rows are the admin's settings and stay as they are; a row whose job is gone stays too (orphaned). Safe when
     * several nodes start at once: a row another node inserted first is left alone.
     */
    public void seed() {
        for (HousekeepingJob job : jobs.values()) {
            if (jobRows.existsById(job.key())) {
                continue;
            }
            JobDefaults defaults = job.defaults();
            Instant now = clock.instant();
            SystemJob row = new SystemJob(
                    job.key(), defaults.enabled(), defaults.cron().trim(), properties.getZone(), defaults.settings(), now);
            row.setNextRunAt(nextRun(defaults.enabled(), defaults.cron(), properties.getZone(), now));
            try {
                tx.executeWithoutResult(status -> jobRows.saveAndFlush(row));
                log.info("Seeded system job '{}' (enabled={}, cron '{}' in {})",
                        job.key(), defaults.enabled(), defaults.cron(), properties.getZone());
            } catch (DataIntegrityViolationException e) {
                log.debug("System job '{}' was seeded by another node", job.key());
            }
        }
    }

    // ------------------------------------------------------------------
    // Claiming
    // ------------------------------------------------------------------

    /** Claims the due, enabled jobs and runs each claimed one on its own virtual thread. */
    public Tick tick() {
        if (closing || jobs.isEmpty()) {
            return new Tick(0, CompletableFuture.completedFuture(null));
        }
        Instant now = clock.instant();
        List<CompletableFuture<Void>> started = new ArrayList<>();
        for (SystemJob row : jobRows.findDue(now, jobs.keySet(), PageRequest.of(0, Math.max(1, jobs.size())))) {
            if (claimer.claim(row.getKey(), row.getVersion(), nodeId, now.plus(lease), now)) {
                launch(jobs.get(row.getKey()), row, JobTrigger.SCHEDULE, false, null).ifPresent(s -> started.add(s.done()));
            }
        }
        return new Tick(started.size(), CompletableFuture.allOf(started.toArray(CompletableFuture[]::new)));
    }

    /** Runs every enabled job with {@link HousekeepingJob#runOnStartup()} once ({@link JobTrigger#STARTUP}). */
    public Tick runStartupJobs() {
        List<CompletableFuture<Void>> started = new ArrayList<>();
        for (HousekeepingJob job : jobs.values()) {
            if (!job.runOnStartup()) {
                continue;
            }
            boolean enabled = jobRows.findById(job.key()).map(SystemJob::isEnabled).orElse(false);
            if (!enabled) {
                continue;
            }
            Optional<Started> run = start(job.key(), JobTrigger.STARTUP, false, null);
            if (run.isPresent()) {
                started.add(run.get().done());
            } else {
                log.info("Startup run of system job '{}' skipped: it is already running", job.key());
            }
        }
        return new Tick(started.size(), CompletableFuture.allOf(started.toArray(CompletableFuture[]::new)));
    }

    /**
     * Claims job {@code key} now, whatever its schedule, and runs it asynchronously; empty when it is running (on any
     * node) or the runner is shutting down. The job's next scheduled slot stays as it is.
     *
     * @throws IllegalArgumentException for a key this runner doesn't know
     */
    public Optional<Started> start(String key, JobTrigger trigger, boolean dryRun, Long startedBy) {
        HousekeepingJob job = job(key).orElseThrow(() -> new IllegalArgumentException("Unknown job '" + key + "'"));
        for (int attempt = 0; attempt < CLAIM_ATTEMPTS && !closing; attempt++) {
            Instant now = clock.instant();
            SystemJob row = jobRows.findById(key).orElse(null);
            if (row == null) {
                seed();
                continue;
            }
            if (row.isLeased(now)) {
                return Optional.empty();
            }
            if (claimer.claim(key, row.getVersion(), nodeId, now.plus(lease), now)) {
                return launch(job, row, trigger, dryRun, startedBy);
            }
            // Lost a race: another claim or an edit changed the row since it was read; look again.
        }
        return Optional.empty();
    }

    /** Opens the run of a job this node just claimed and hands it to a virtual thread. */
    private Optional<Started> launch(HousekeepingJob job, SystemJob row, JobTrigger trigger, boolean dryRun, Long startedBy) {
        SystemJobRun run;
        try {
            run = tx.execute(status -> begin(job.key(), trigger, dryRun && job.supportsDryRun(), startedBy));
        } catch (RuntimeException e) {
            log.error("Could not start system job '{}' on node {}", job.key(), nodeId, e);
            claimer.release(job.key(), nodeId);
            return Optional.empty();
        }
        Execution execution = new Execution(job, run, JobSettings.of(effectiveSettings(job, row.getSettings())));
        running.put(job.key(), execution);
        try {
            CompletableFuture<Void> done = CompletableFuture.runAsync(() -> execute(execution), executor);
            return Optional.of(new Started(run, done));
        } catch (java.util.concurrent.RejectedExecutionException e) {
            // Shutting down between claim and hand-off: close() records the run and releases the lease.
            return Optional.empty();
        }
    }

    /** Fails what a dead holder left open and writes the new run. */
    private SystemJobRun begin(String key, JobTrigger trigger, boolean dryRun, Long startedBy) {
        Instant now = clock.instant();
        int interrupted = runs.failOpenRuns(key, now, INTERRUPTED);
        if (interrupted > 0) {
            log.warn("System job '{}': {} run(s) left open by a stopped node recorded as failed", key, interrupted);
        }
        SystemJobRun run = runs.saveAndFlush(new SystemJobRun(key, trigger, dryRun, now, startedBy));
        jdbc.update("UPDATE system_job SET last_run_id = ? WHERE \"key\" = ? AND lease_owner = ?", run.getId(), key, nodeId);
        return run;
    }

    // ------------------------------------------------------------------
    // One claimed run
    // ------------------------------------------------------------------

    private void execute(Execution execution) {
        String key = execution.job.key();
        long period = Math.max(500, lease.toMillis() / 2);
        ScheduledFuture<?> keeper = leaseKeeper.scheduleAtFixedRate(
                () -> renew(execution), period, period, TimeUnit.MILLISECONDS);
        long startNanos = System.nanoTime();
        JobResult result;
        Throwable error = null;
        try {
            List<String> problems = execution.job.validateSettings(execution.settings.json());
            if (problems != null && !problems.isEmpty()) {
                result = JobResult.failed("Invalid settings: " + String.join(" ", problems));
            } else {
                result = execution.job.run(execution);
                if (result == null) {
                    result = JobResult.succeeded();
                }
            }
        } catch (JobCancelledException e) {
            result = JobResult.failed("Cancelled: " + e.getMessage());
        } catch (Exception | Error e) {
            log.warn("System job '{}' failed", key, e);
            error = e;
            result = JobResult.failed("Failed: " + describe(e));
        } finally {
            keeper.cancel(false);
        }
        Duration took = Duration.ofNanos(System.nanoTime() - startNanos);
        try {
            JobResult outcome = result;
            Throwable failure = error;
            tx.executeWithoutResult(status -> finish(execution, outcome, failure));
            record(execution, result.outcome(), took);
        } catch (RuntimeException e) {
            // The lease expires and the next claim records the open run as interrupted.
            log.error("Could not record the run of system job '{}' on node {}", key, nodeId, e);
        } finally {
            running.remove(key, execution);
        }
    }

    private void finish(Execution execution, JobResult result, Throwable error) {
        Instant now = clock.instant();
        SystemJobRun run = runs.findById(execution.run.getId()).orElse(null);
        if (run != null) {
            String message = result.message() == null || result.message().isBlank() ? execution.summary() : result.message();
            run.finish(now, result.outcome(), message, execution.examined.get(), execution.affected.get(),
                    execution.bytes.get(), execution.reportJson(error));
            runs.save(run);
        }
        releaseAndReschedule(execution, now);
        capHistory(execution.job.key());
    }

    /**
     * Lets go of the job and sets its next slot, from the row as it is now: an admin may have changed cron, zone or
     * enabled while it ran (their edit bumps {@code version}, so this retries on the fresh row).
     */
    private void releaseAndReschedule(Execution execution, Instant now) {
        String key = execution.job.key();
        for (int attempt = 0; attempt < FINISH_ATTEMPTS; attempt++) {
            Map<String, Object> row = jdbc.queryForList(
                            "SELECT enabled, cron, zone_id, next_run_at, lease_owner, version FROM system_job WHERE \"key\" = ?",
                            key)
                    .stream()
                    .findFirst()
                    .orElse(null);
            if (row == null || !nodeId.equals(row.get("lease_owner"))) {
                log.warn("Node {} lost the lease of system job '{}' while running it", nodeId, key);
                return;
            }
            Instant next = nextSlot(execution.run.getTrigger(), row, now);
            int updated = jdbc.update(
                    "UPDATE system_job SET lease_owner = NULL, lease_until = NULL, next_run_at = ?, version = version + 1"
                            + " WHERE \"key\" = ? AND lease_owner = ? AND version = ?",
                    next == null ? null : OffsetDateTime.ofInstant(next, ZoneOffset.UTC),
                    key,
                    nodeId,
                    ((Number) row.get("version")).longValue());
            if (updated == 1) {
                return;
            }
        }
        log.warn("Node {} could not reschedule system job '{}'; releasing its lease only", nodeId, key);
        claimer.release(key, nodeId);
    }

    /** A scheduled run moves to the first slot after now; a manual or startup run keeps the job's schedule. */
    private static Instant nextSlot(JobTrigger trigger, Map<String, Object> row, Instant now) {
        boolean enabled = Boolean.TRUE.equals(row.get("enabled"));
        Instant current = instant(row.get("next_run_at"));
        if (!enabled) {
            return null;
        }
        if (trigger != JobTrigger.SCHEDULE && current != null) {
            return current;
        }
        try {
            return nextRun(true, (String) row.get("cron"), (String) row.get("zone_id"), now);
        } catch (RuntimeException e) {
            log.error("System job has an unusable schedule (cron '{}', zone '{}'); it won't run on a schedule",
                    row.get("cron"), row.get("zone_id"), e);
            return null;
        }
    }

    private void capHistory(String key) {
        int keep = Math.max(1, properties.getHistoryPerJob());
        runs.findIdsNewestFirst(key, PageRequest.of(keep, 1)).stream()
                .findFirst()
                .ifPresent(oldest -> runs.deleteByJobKeyAndIdAtMost(key, oldest));
    }

    private void renew(Execution execution) {
        String key = execution.job.key();
        try {
            if (!claimer.extend(key, nodeId, clock.instant().plus(lease))) {
                log.warn("Node {} no longer holds the lease of system job '{}'; cancelling the run", nodeId, key);
                execution.cancel("the node lost the job's lease");
                return;
            }
            execution.persistProgress();
        } catch (RuntimeException e) {
            log.warn("Could not renew the lease of system job '{}'", key, e);
        }
    }

    private void record(Execution execution, JobOutcome outcome, Duration took) {
        String key = execution.job.key();
        Timer.builder("sf.job.duration")
                .description("How long system job runs took")
                .tag("job", key)
                .tag("outcome", outcome.name())
                .register(meters)
                .record(took);
        if (execution.run.isDryRun()) {
            return;
        }
        Counter.builder("sf.job.items").tag("job", key).tag("kind", "examined").register(meters)
                .increment(execution.examined.get());
        Counter.builder("sf.job.items").tag("job", key).tag("kind", "affected").register(meters)
                .increment(execution.affected.get());
        Counter.builder("sf.job.bytes.freed").tag("job", key).register(meters).increment(execution.bytes.get());
    }

    private double lastSuccessAgeSeconds(String key) {
        try {
            Instant last = runs.findLastSuccess(key);
            return last == null ? Double.NaN : Math.max(0, Duration.between(last, clock.instant()).toMillis() / 1000.0);
        } catch (RuntimeException e) {
            return Double.NaN;
        }
    }

    // ------------------------------------------------------------------
    // Shutdown
    // ------------------------------------------------------------------

    /**
     * Signals cancellation to the running jobs, waits up to 10 s for them to record their runs, then releases what is
     * still held (its run recorded as {@code FAILED}) so another node can take over at once.
     */
    @Override
    public void close() {
        closing = true;
        running.values().forEach(execution -> execution.cancel("the node is shutting down"));
        executor.shutdown();
        try {
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        }
        leaseKeeper.shutdownNow();
        for (Execution execution : running.values()) {
            try {
                jdbc.update("UPDATE system_job_run SET finished_at = ?, outcome = ?, message = ? WHERE id = ? AND finished_at IS NULL",
                        OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC), JobOutcome.FAILED.name(),
                        "Cancelled: the node shut down before the run ended.", execution.run.getId());
                claimer.release(execution.job.key(), nodeId);
            } catch (RuntimeException e) {
                log.warn("Could not release system job '{}' on shutdown", execution.job.key(), e);
            }
        }
        running.clear();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** Rejects a job whose key or defaults can never work, at startup rather than at its first run. */
    private static void check(HousekeepingJob job) {
        String key = job.key();
        if (key == null || key.length() > MAX_KEY || !KEY.matcher(key).matches()) {
            throw new IllegalStateException("Housekeeping job key must be kebab-case, at most " + MAX_KEY
                    + " characters: '" + key + "' (" + job.getClass().getName() + ")");
        }
        JobDefaults defaults = job.defaults();
        try {
            ScheduleTiming.normalizeCron(defaults.cron());
        } catch (SfException e) {
            throw new IllegalStateException("Housekeeping job '" + key + "' has an invalid default cron '"
                    + defaults.cron() + "'", e);
        }
        List<String> problems = job.validateSettings(defaults.settings());
        if (problems != null && !problems.isEmpty()) {
            throw new IllegalStateException("Housekeeping job '" + key + "' has invalid default settings: " + problems);
        }
    }

    private static Instant instant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof OffsetDateTime odt) {
            return odt.toInstant();
        }
        if (value instanceof java.sql.Timestamp ts) {
            return ts.toInstant();
        }
        if (value instanceof Instant instant) {
            return instant;
        }
        if (value instanceof java.time.ZonedDateTime zdt) {
            return zdt.toInstant();
        }
        throw new IllegalStateException("Unexpected timestamp type " + value.getClass());
    }

    private static String describe(Throwable e) {
        if (e instanceof SfException sf && sf.getProblem() != null && sf.getProblem().getDetail() != null) {
            return sf.getProblem().getDetail();
        }
        return e.getClass().getSimpleName() + (e.getMessage() == null ? "" : ": " + e.getMessage());
    }

    /** The exception chain with the first frames of each: enough to find the failing line, bounded in size. */
    static String digest(Throwable error) {
        StringBuilder out = new StringBuilder();
        Throwable current = error;
        for (int depth = 0; current != null && depth < 4; depth++, current = current.getCause()) {
            if (depth > 0) {
                out.append("Caused by: ");
            }
            out.append(current.getClass().getName());
            if (current.getMessage() != null) {
                out.append(": ").append(current.getMessage());
            }
            out.append('\n');
            StackTraceElement[] frames = current.getStackTrace();
            int shown = Math.min(frames.length, depth == 0 ? 10 : 5);
            for (int i = 0; i < shown; i++) {
                out.append("  at ").append(frames[i]).append('\n');
            }
            if (frames.length > shown) {
                out.append("  … ").append(frames.length - shown).append(" more\n");
            }
            if (current.getCause() == current) {
                break;
            }
        }
        return out.length() > 4000 ? out.substring(0, 3999) + "…" : out.toString();
    }

    /** {@code 4.2 MB}, {@code 512 B}. */
    static String humanBytes(long bytes) {
        if (bytes < 1024) {
            return bytes + " B";
        }
        String[] units = {"KB", "MB", "GB", "TB"};
        double value = bytes;
        int unit = -1;
        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }
        return String.format(Locale.ROOT, "%.1f %s", value, units[unit]);
    }

    // ------------------------------------------------------------------
    // The job's view of one run
    // ------------------------------------------------------------------

    private final class Execution implements JobContext {

        final HousekeepingJob job;
        final SystemJobRun run;
        final JobSettings settings;
        final AtomicLong examined = new AtomicLong();
        final AtomicLong affected = new AtomicLong();
        final AtomicLong bytes = new AtomicLong();
        private final ArrayNode sample = JsonNodeFactory.instance.arrayNode();
        private long sampleTotal;
        private final ObjectNode report = JsonNodeFactory.instance.objectNode();
        private volatile String progress;
        private volatile String persistedProgress;
        private volatile String cancelReason;

        Execution(HousekeepingJob job, SystemJobRun run, JobSettings settings) {
            this.job = job;
            this.run = run;
            this.settings = settings;
        }

        void cancel(String reason) {
            if (cancelReason == null) {
                cancelReason = reason;
            }
        }

        void persistProgress() {
            String current = progress;
            if (current != null && !current.equals(persistedProgress)) {
                jdbc.update("UPDATE system_job_run SET message = ? WHERE id = ? AND finished_at IS NULL",
                        SystemJobRun.truncate(current), run.getId());
                persistedProgress = current;
            }
        }

        String summary() {
            boolean dry = run.isDryRun();
            StringBuilder out = new StringBuilder(dry ? "Dry run: examined " : "Examined ")
                    .append(examined.get())
                    .append(dry ? ", would affect " : ", affected ")
                    .append(affected.get());
            if (bytes.get() > 0) {
                out.append(dry ? ", would free " : ", freed ").append(humanBytes(bytes.get()));
            }
            return out.append('.').toString();
        }

        ObjectNode reportJson(Throwable error) {
            ObjectNode out = report.deepCopy();
            synchronized (sample) {
                out.set("sample", sample.deepCopy());
                out.put("sampleTotal", sampleTotal);
            }
            if (error != null) {
                ObjectNode detail = out.putObject("error");
                detail.put("type", error.getClass().getName());
                detail.put("message", error.getMessage());
                detail.put("stackTrace", digest(error));
            }
            return out;
        }

        @Override
        public String jobKey() {
            return job.key();
        }

        @Override
        public long runId() {
            return run.getId();
        }

        @Override
        public JobTrigger trigger() {
            return run.getTrigger();
        }

        @Override
        public boolean dryRun() {
            return run.isDryRun();
        }

        @Override
        public JobSettings settings() {
            return settings;
        }

        @Override
        public Clock clock() {
            return clock;
        }

        @Override
        public Instant now() {
            return clock.instant();
        }

        @Override
        public boolean isCancelled() {
            return cancelReason != null;
        }

        @Override
        public void checkCancelled() {
            String reason = cancelReason;
            if (reason != null) {
                throw new JobCancelledException(reason);
            }
        }

        @Override
        public void examined(long count) {
            examined.addAndGet(count);
        }

        @Override
        public void affected(long count) {
            affected.addAndGet(count);
        }

        @Override
        public void bytesFreed(long count) {
            bytes.addAndGet(count);
        }

        @Override
        public long examinedCount() {
            return examined.get();
        }

        @Override
        public long affectedCount() {
            return affected.get();
        }

        @Override
        public long bytesFreedCount() {
            return bytes.get();
        }

        @Override
        public void sample(String item) {
            sample(item == null ? JsonNodeFactory.instance.nullNode() : JsonNodeFactory.instance.textNode(item));
        }

        @Override
        public void sample(JsonNode item) {
            synchronized (sample) {
                sampleTotal++;
                if (sample.size() < MAX_SAMPLE) {
                    sample.add(item == null ? JsonNodeFactory.instance.nullNode() : item.deepCopy());
                }
            }
        }

        @Override
        public ObjectNode report() {
            return report;
        }

        @Override
        public void progress(String message) {
            progress = message;
        }

        @Override
        public <T> T inTransaction(Supplier<T> work) {
            return batchTx.execute(status -> work.get());
        }

        @Override
        public void inTransaction(Runnable work) {
            batchTx.executeWithoutResult(status -> work.run());
        }
    }
}
