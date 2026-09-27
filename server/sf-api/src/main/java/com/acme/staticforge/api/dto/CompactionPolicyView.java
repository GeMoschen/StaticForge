package com.acme.staticforge.api.dto;

import java.time.Instant;

/**
 * A project's revision compaction (M29.4.1, spec §7.7): the policy, how far compaction got and what the job last did
 * for the project. Response of {@code GET}/{@code PUT /projects/{key}/compaction}.
 *
 * @param enabled whether the weekly {@code revision-compaction} job compacts the project
 * @param olderThanDays only history older than this is compacted (at least 30)
 * @param enabledAt when compaction was switched on; {@code null} while off
 * @param enabledBy the user id who switched it on; {@code null} while off
 * @param compactedThrough the newest revision compaction has processed; {@code null} when it never ran
 * @param lastRun the job's last run for this project; {@code null} when there is none in the recent history
 */
public record CompactionPolicyView(
        boolean enabled,
        int olderThanDays,
        Instant enabledAt,
        Long enabledBy,
        Long compactedThrough,
        LastRun lastRun) {

    /**
     * One run of the job for this project.
     *
     * @param runId the {@code system_job_run} id (see {@code /admin/jobs/revision-compaction/runs})
     * @param outcome the run's outcome ({@code SUCCEEDED}, {@code PARTIAL}, {@code FAILED}, …)
     * @param cutoff versions of revisions before this instant were in the window
     * @param error why this project failed in the run; {@code null} when it didn't
     */
    public record LastRun(
            long runId,
            Instant finishedAt,
            boolean dryRun,
            String outcome,
            Instant cutoff,
            String error,
            long versionsInWindow,
            long assetsTouched,
            long versionsRemoved,
            long referencesRewritten,
            long revisionsMarked,
            long bytesFreed) {}
}
