package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/**
 * One system job (M29.1.2): its schedule and settings (as a run uses them), its defaults, whether it runs now and its
 * newest finished run. {@code version} is the value for {@code If-Match} on an edit (also sent as
 * {@code ETag: "v{version}"}). An {@code orphaned} job (its code is gone) has no name, description or defaults and
 * never runs. {@code startedAt}, {@code currentRunId} and {@code progress} are set only while it is {@code running}.
 */
public record AdminJobView(
        String key,
        String name,
        String description,
        boolean enabled,
        String cron,
        String zone,
        JsonNode settings,
        JobDefaults defaults,
        Instant nextRunAt,
        boolean running,
        Instant startedAt,
        Long currentRunId,
        String progress,
        boolean supportsDryRun,
        boolean orphaned,
        long version,
        Instant updatedAt,
        JobRunSummary lastRun) {

    /** What <em>Reset to defaults</em> restores. */
    public record JobDefaults(boolean enabled, String cron, String zone, JsonNode settings) {}

    /** The newest finished run. {@code durationMs} from start to finish. */
    public record JobRunSummary(
            long id,
            String outcome,
            String trigger,
            boolean dryRun,
            Instant startedAt,
            Instant finishedAt,
            Long durationMs,
            long itemsExamined,
            long itemsAffected,
            long bytesFreed,
            String message) {}
}
