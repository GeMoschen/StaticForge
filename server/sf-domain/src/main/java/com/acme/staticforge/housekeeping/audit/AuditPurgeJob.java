package com.acme.staticforge.housekeeping.audit;

import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.housekeeping.JobDefaults;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.SettingsSpec;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Job {@code audit-purge} (M29.2.4, epic decision 7; spec §26.3): deletes audit entries — instance-level and project
 * entries alike — whose {@code created_at} is older than {@code retentionDays} (default 365, at least 30).
 *
 * <p>Entries go in batches of at most {@code batchSize}, each an id range deleted in its own short transaction, so
 * PostgreSQL's WAL and locks stay small. The report holds the count per action ({@code byAction}), the split into
 * instance and project entries and the oldest entry that remains. A dry run reports the same and deletes nothing.
 *
 * <p>Lowering the retention is a settings change and is audited as {@code JOB_SETTINGS_SET} like every job's, so it
 * leaves a trace this purge only removes once that entry itself has aged out.
 */
@Component
public class AuditPurgeJob implements HousekeepingJob {

    public static final String KEY = "audit-purge";

    static final SettingsSpec SETTINGS = SettingsSpec.builder()
            .integer("retentionDays", 30, 36_500)
            .integer("batchSize", 1, 100_000)
            .build();

    private final AuditPurgeProperties properties;
    private final JdbcTemplate jdbc;

    public AuditPurgeJob(AuditPurgeProperties properties, JdbcTemplate jdbc) {
        this.properties = properties;
        this.jdbc = jdbc;
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Audit purge";
    }

    @Override
    public String description() {
        return "Deletes audit log entries older than the retention (one year by default).";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> settings
                .put("retentionDays", properties.getRetentionDays())
                .put("batchSize", properties.getBatchSize()));
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    @Override
    public boolean supportsDryRun() {
        return true;
    }

    @Override
    public JobResult run(JobContext ctx) {
        int retentionDays = ctx.settings().intValue("retentionDays");
        int batchSize = ctx.settings().intValue("batchSize");
        OffsetDateTime cutoff = utc(ctx.now().minus(Duration.ofDays(retentionDays)));

        ObjectNode report = ctx.report();
        report.put("retentionDays", retentionDays);
        report.put("cutoff", cutoff.toInstant().toString());
        ObjectNode byAction = report.putObject("byAction");
        long total = 0;
        for (var row : jdbc.queryForList(
                "SELECT action, COUNT(*) AS n FROM audit_log WHERE created_at < ? GROUP BY action ORDER BY action",
                cutoff)) {
            long n = ((Number) row.get("n")).longValue();
            byAction.put((String) row.get("action"), n);
            total += n;
        }
        Long instanceEntries = jdbc.queryForObject(
                "SELECT COUNT(*) FROM audit_log WHERE created_at < ? AND project_id IS NULL", Long.class, cutoff);
        report.put("instanceEntries", instanceEntries == null ? 0 : instanceEntries);
        report.put("projectEntries", total - (instanceEntries == null ? 0 : instanceEntries));
        ctx.examined(total);
        jdbc.query(
                "SELECT id, action, project_id, created_at FROM audit_log WHERE created_at < ? ORDER BY id LIMIT ?",
                rs -> {
                    ObjectNode item = report.objectNode()
                            .put("id", rs.getLong("id"))
                            .put("action", rs.getString("action"))
                            .put("createdAt", rs.getObject("created_at", OffsetDateTime.class)
                                    .toInstant()
                                    .toString());
                    long projectId = rs.getLong("project_id");
                    if (!rs.wasNull()) {
                        item.put("projectId", projectId);
                    }
                    ctx.sample(item);
                },
                cutoff,
                JobContext.MAX_SAMPLE);

        if (ctx.dryRun()) {
            ctx.affected(total);
            putOldestRemaining(report, cutoff);
            return JobResult.succeeded("Would delete " + total + " audit entries older than " + retentionDays + " days.");
        }

        long deleted = 0;
        while (true) {
            ctx.checkCancelled();
            int removed = ctx.inTransaction(() -> deleteBatch(cutoff, batchSize));
            if (removed == 0) {
                break;
            }
            deleted += removed;
            ctx.affected(removed);
            ctx.progress("Deleted " + deleted + " of " + total + " audit entries");
        }
        putOldestRemaining(report, cutoff);
        return JobResult.succeeded("Deleted " + deleted + " audit entries older than " + retentionDays + " days.");
    }

    /** Deletes the oldest (by id) batch of expired entries as one id range; the number deleted. */
    private int deleteBatch(OffsetDateTime cutoff, int batchSize) {
        List<Long> ids = jdbc.queryForList(
                "SELECT id FROM audit_log WHERE created_at < ? ORDER BY id LIMIT ?", Long.class, cutoff, batchSize);
        if (ids.isEmpty()) {
            return 0;
        }
        return jdbc.update(
                "DELETE FROM audit_log WHERE id BETWEEN ? AND ? AND created_at < ?",
                ids.get(0),
                ids.get(ids.size() - 1),
                cutoff);
    }

    /** {@code oldestRemaining}: the oldest entry a (real) purge leaves, absent when the log would be empty. */
    private void putOldestRemaining(ObjectNode report, OffsetDateTime cutoff) {
        OffsetDateTime oldest = jdbc.queryForObject(
                "SELECT MIN(created_at) FROM audit_log WHERE created_at >= ?", OffsetDateTime.class, cutoff);
        if (oldest != null) {
            report.put("oldestRemaining", oldest.toInstant().toString());
        }
    }

    private static OffsetDateTime utc(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
