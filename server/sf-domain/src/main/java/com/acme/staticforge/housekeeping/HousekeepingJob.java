package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * An instance-level background job (M29.1.1, epic decisions 1–4): a Spring bean the {@link SystemJobRunner} runs on its
 * cron, at startup ({@link #runOnStartup()}) or by hand, at most once at a time on any node. Adding a job is adding a
 * bean; its {@code system_job} row is seeded from {@link #defaults()} on the next start.
 *
 * <p>A job gets its defaults from its own {@code sf.housekeeping.<key>.*} block (a {@link JobProperties} subclass),
 * declares its settings with a {@link SettingsSpec} and reads them in {@link #run} through {@link JobContext#settings()}.
 * Settings the admin saves are validated with {@link #validateSettings} first; unknown keys are refused.
 *
 * <p>{@link #run} runs on a virtual thread outside any transaction; see {@link JobContext} for batching, cancellation
 * and reporting. A thrown exception records the run as {@link JobOutcome#FAILED} and never affects the next run.
 */
public interface HousekeepingJob {

    /** Stable id, kebab-case ({@code blob-sweep}), at most 64 characters; the row's primary key and the metric tag. */
    String key();

    /** A short name for the admin UI ("Blob sweep"). */
    String displayName();

    /** One or two sentences on what the job does and what it removes. */
    String description();

    /** Schedule and settings the first start seeds and <em>Reset to defaults</em> restores. */
    JobDefaults defaults();

    /** Every problem of {@code settings} (a full settings object), one message each; empty when valid. */
    List<String> validateSettings(JsonNode settings);

    /** Whether the job can report what it would do without doing it (epic decision 4: every destructive job). */
    default boolean supportsDryRun() {
        return false;
    }

    /** Whether the job also runs once after the application became ready ({@link JobTrigger#STARTUP}). */
    default boolean runOnStartup() {
        return false;
    }

    /** Does the work; any exception (checked ones too, e.g. store I/O) records the run as failed. */
    JobResult run(JobContext ctx) throws Exception;
}
