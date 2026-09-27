package com.acme.staticforge.housekeeping;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.scheduler.ScheduleTiming;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.TreeMap;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The system jobs as the admin API and the UI see them (M29.1.1–M29.1.2, epic decisions 3–5, 14): their state, run
 * history, schedule and settings edits, <em>Reset to defaults</em> and <em>Run now</em>. Runs themselves belong to
 * the application's {@link SystemJobRunner}.
 *
 * <p>Edits are validated as a whole ({@code 422 SF-DOM-0180} listing every problem), recompute the next slot and are
 * audited {@code JOB_SETTINGS_SET} with before and after; a manual run is audited {@code JOB_RUN}. Both are
 * instance-level entries (no project) with the target {@code job:<key>}. Scheduled runs are recorded in the run
 * history only.
 */
@Service
public class SystemJobService {

    public static final String AUDIT_SETTINGS_SET = "JOB_SETTINGS_SET";
    public static final String AUDIT_RUN = "JOB_RUN";

    private final SystemJobRunner runner;
    private final SystemJobRepository jobRows;
    private final SystemJobRunRepository runs;
    private final HousekeepingProperties properties;
    private final AuditService audit;
    private final Clock clock;

    public SystemJobService(
            SystemJobRunner runner,
            SystemJobRepository jobRows,
            SystemJobRunRepository runs,
            HousekeepingProperties properties,
            AuditService audit,
            Clock clock) {
        this.runner = runner;
        this.jobRows = jobRows;
        this.runs = runs;
        this.properties = properties;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * One job: its row, its bean ({@code null} when the row is orphaned — the bean is gone), the settings a run uses,
     * whether it runs now (on any node) with that run, and its newest finished run.
     */
    public record JobState(
            SystemJob row,
            HousekeepingJob job,
            ObjectNode settings,
            boolean running,
            SystemJobRun current,
            SystemJobRun lastRun) {

        public String key() {
            return row.getKey();
        }

        public boolean orphaned() {
            return job == null;
        }
    }

    /** A job's defaults as <em>Reset to defaults</em> would restore them. */
    public record Defaults(boolean enabled, String cron, String zone, ObjectNode settings) {}

    /** A partial edit; {@code null} members stay as they are. {@code settings} is merged key by key. */
    public record Update(Boolean enabled, String cron, String zone, JsonNode settings) {}

    /** Every job with a row, installed ones and orphaned ones, by key. */
    @Transactional(readOnly = true)
    public List<JobState> list() {
        Instant now = clock.instant();
        Map<String, SystemJob> rows = new TreeMap<>();
        jobRows.findAllByOrderByKey().forEach(row -> rows.put(row.getKey(), row));
        List<JobState> out = new ArrayList<>(rows.size());
        rows.values().forEach(row -> out.add(state(row, now)));
        return out;
    }

    /** One job; {@code 404 SF-DOM-0184} for a key without a row. */
    @Transactional(readOnly = true)
    public JobState get(String key) {
        return state(requireRow(key), clock.instant());
    }

    /** The defaults of an installed job ({@code null} for an orphaned one). */
    public Defaults defaults(String key) {
        return runner.job(key)
                .map(job -> {
                    JobDefaults d = job.defaults();
                    return new Defaults(d.enabled(), d.cron(), properties.getZone(), d.settings());
                })
                .orElse(null);
    }

    /** A job's run history, newest first. */
    @Transactional(readOnly = true)
    public Page<SystemJobRun> runs(String key, Pageable pageable) {
        requireRow(key);
        return runs.findByJobKeyOrderByStartedAtDescIdDesc(key, pageable);
    }

    /** One run of a job; {@code 404} when the job has no such run. */
    @Transactional(readOnly = true)
    public SystemJobRun run(String key, long runId) {
        requireRow(key);
        return runs.findById(runId)
                .filter(run -> run.getJobKey().equals(key))
                .orElseThrow(() -> new SfException(
                        ProblemFactory.notFound("Job '" + key + "' has no run " + runId + ".")));
    }

    /**
     * Changes schedule and settings of an installed job read at {@code expectedVersion} ({@code 409 SF-API-0409} when
     * stale). Invalid cron, zone or settings: {@code 422 SF-DOM-0180} with one message per problem. An edit that
     * changes nothing is not audited.
     */
    @Transactional
    public JobState update(String key, long expectedVersion, Update update, Long actorUserId) {
        SystemJob row = requireRow(key);
        HousekeepingJob job = requireInstalled(row);
        if (row.getVersion() != expectedVersion) {
            throw new SfException(ProblemFactory.conflict(
                    "Job '" + key + "' was changed in the meantime (version " + row.getVersion() + "); reload it."));
        }
        List<String> errors = new ArrayList<>();
        String cron = update.cron() == null ? row.getCron() : checkCron(update.cron(), errors);
        String zone = update.zone() == null ? row.getZoneId() : checkZone(update.zone(), errors);
        ObjectNode settings = SystemJobRunner.effectiveSettings(job, row.getSettings());
        if (update.settings() != null) {
            if (!update.settings().isObject()) {
                errors.add("Settings must be a JSON object.");
            } else {
                update.settings().fields().forEachRemaining(field -> {
                    if (field.getValue() == null || field.getValue().isNull()) {
                        settings.remove(field.getKey());
                    } else {
                        settings.set(field.getKey(), field.getValue().deepCopy());
                    }
                });
                List<String> problems = job.validateSettings(settings);
                if (problems != null) {
                    errors.addAll(problems);
                }
            }
        }
        if (!errors.isEmpty()) {
            throw HousekeepingProblems.invalidSettings(errors);
        }
        boolean enabled = update.enabled() == null ? row.isEnabled() : update.enabled();
        return apply(row, job, enabled, cron, zone, settings, actorUserId, false);
    }

    /** Restores the job's property defaults and {@code sf.housekeeping.zone}; audited like an edit. */
    @Transactional
    public JobState reset(String key, Long actorUserId) {
        SystemJob row = requireRow(key);
        HousekeepingJob job = requireInstalled(row);
        JobDefaults defaults = job.defaults();
        return apply(row, job, defaults.enabled(), defaults.cron().trim(), properties.getZone(), defaults.settings(),
                actorUserId, true);
    }

    /**
     * Starts a run of {@code key} now and returns its row; it runs asynchronously. {@code 409 SF-DOM-0181} when the
     * job is running on any node; {@code 422 SF-DOM-0180} for a dry run of a job without one. Audited
     * {@code JOB_RUN}.
     */
    public SystemJobRun runNow(String key, boolean dryRun, Long actorUserId) {
        SystemJob row = requireRow(key);
        HousekeepingJob job = requireInstalled(row);
        if (dryRun && !job.supportsDryRun()) {
            throw HousekeepingProblems.invalidSettings(List.of("Job '" + key + "' has no dry run."));
        }
        SystemJobRun run = runner.start(key, JobTrigger.MANUAL, dryRun, actorUserId)
                .orElseThrow(() -> HousekeepingProblems.alreadyRunning(key))
                .run();
        ObjectNode detail = JsonNodeFactory.instance.objectNode();
        detail.put("runId", run.getId());
        detail.put("dryRun", dryRun);
        audit.record(null, actorUserId, AUDIT_RUN, target(key), detail);
        return run;
    }

    // ------------------------------------------------------------------

    private JobState apply(
            SystemJob row,
            HousekeepingJob job,
            boolean enabled,
            String cron,
            String zone,
            ObjectNode settings,
            Long actorUserId,
            boolean reset) {
        ObjectNode before = snapshot(row.isEnabled(), row.getCron(), row.getZoneId(),
                SystemJobRunner.effectiveSettings(job, row.getSettings()));
        ObjectNode after = snapshot(enabled, cron, zone, settings);
        Instant now = clock.instant();
        if (before.equals(after)) {
            return state(row, now);
        }
        row.setEnabled(enabled);
        row.setCron(cron);
        row.setZoneId(zone);
        row.setSettings(settings);
        row.setNextRunAt(SystemJobRunner.nextRun(enabled, cron, zone, now));
        row.setUpdatedAt(now);
        row.setUpdatedBy(actorUserId);
        SystemJob saved = jobRows.saveAndFlush(row);
        ObjectNode detail = JsonNodeFactory.instance.objectNode();
        detail.set("before", before);
        detail.set("after", after);
        if (reset) {
            detail.put("reset", true);
        }
        audit.record(null, actorUserId, AUDIT_SETTINGS_SET, target(job.key()), detail);
        return state(saved, now);
    }

    private JobState state(SystemJob row, Instant now) {
        HousekeepingJob job = runner.job(row.getKey()).orElse(null);
        ObjectNode settings = job == null
                ? (row.getSettings() instanceof ObjectNode stored ? stored : JsonNodeFactory.instance.objectNode())
                : SystemJobRunner.effectiveSettings(job, row.getSettings());
        boolean running = row.isLeased(now);
        SystemJobRun current = running && row.getLastRunId() != null
                ? runs.findById(row.getLastRunId()).filter(run -> !run.isFinished()).orElse(null)
                : null;
        SystemJobRun last = runs.findFirstByJobKeyAndFinishedAtIsNotNullOrderByStartedAtDescIdDesc(row.getKey())
                .orElse(null);
        return new JobState(row, job, settings, running, current, last);
    }

    private SystemJob requireRow(String key) {
        Optional<SystemJob> row = key == null ? Optional.empty() : jobRows.findById(key);
        return row.orElseThrow(() -> HousekeepingProblems.unknownJob(key, null));
    }

    private HousekeepingJob requireInstalled(SystemJob row) {
        return runner.job(row.getKey())
                .orElseThrow(() -> HousekeepingProblems.unknownJob(row.getKey(),
                        "Job '" + row.getKey() + "' is no longer installed; it can't be changed or run."));
    }

    private static String checkCron(String cron, List<String> errors) {
        String trimmed = cron.trim().replaceAll("\\s+", " ");
        try {
            ScheduleTiming.normalizeCron(trimmed);
            return trimmed;
        } catch (SfException e) {
            errors.add(e.getProblem().getDetail());
            return null;
        }
    }

    private static String checkZone(String zone, List<String> errors) {
        if (zone.isBlank()) {
            errors.add("A time zone is required.");
            return null;
        }
        try {
            return ZoneId.of(zone.trim()).getId();
        } catch (DateTimeException e) {
            errors.add("Unknown time zone '" + zone + "'.");
            return null;
        }
    }

    private static ObjectNode snapshot(boolean enabled, String cron, String zone, JsonNode settings) {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.put("enabled", enabled);
        node.put("cron", cron);
        node.put("zone", zone);
        node.set("settings", settings == null ? JsonNodeFactory.instance.objectNode() : settings.deepCopy());
        return node;
    }

    static String target(String key) {
        return "job:" + Objects.requireNonNull(key);
    }
}
