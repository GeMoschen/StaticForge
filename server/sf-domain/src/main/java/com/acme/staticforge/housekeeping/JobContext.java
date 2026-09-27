package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.time.Instant;
import java.util.function.Supplier;

/**
 * One run of a {@link HousekeepingJob}, as the job sees it (M29.1.1). {@link HousekeepingJob#run} is called outside
 * any transaction: a job works in short transactions of its own ({@link #inTransaction}), one per batch, and checks
 * {@link #checkCancelled()} between batches so a shutdown or a lost lease stops it within one batch.
 *
 * <p>What the run reports:
 *
 * <ul>
 *   <li>counters: {@link #examined}, {@link #affected}, {@link #bytesFreed} (thread-safe, summed), stored on the run
 *       and exported as {@code sf.job.*} metrics;
 *   <li>a bounded sample of items ({@link #sample}): at most {@value #MAX_SAMPLE} are kept, the rest only counted — a
 *       dry run lists here what a real run would remove;
 *   <li>structured data for the run's {@code report} ({@link #report()}, e.g. a per-project breakdown);
 *   <li>a progress message ({@link #progress}) the admin UI shows while the run is going.
 * </ul>
 *
 * A dry run ({@link #dryRun()}) must not change anything; it counts and samples what it would do.
 */
public interface JobContext {

    /** The most items {@link #sample} keeps. */
    int MAX_SAMPLE = 50;

    String jobKey();

    /** The {@code system_job_run} row of this run. */
    long runId();

    JobTrigger trigger();

    /** Report what would be done, change nothing. Only ever {@code true} for jobs that {@link HousekeepingJob#supportsDryRun()}. */
    boolean dryRun();

    /** The job's persisted settings, validated. */
    JobSettings settings();

    /** The runner's clock; take "now" from here so tests can move time. */
    Clock clock();

    /** {@code clock().instant()}. */
    Instant now();

    /** Whether the run should stop: the node is shutting down or lost the job's lease. */
    boolean isCancelled();

    /** Throws {@link JobCancelledException} when {@link #isCancelled()}; call it between batches. */
    void checkCancelled();

    /** Adds {@code count} to the items the run looked at. */
    void examined(long count);

    /** Adds {@code count} to the items the run changed or removed (would change, in a dry run). */
    void affected(long count);

    /** Adds {@code bytes} to the storage the run freed (would free, in a dry run). */
    void bytesFreed(long bytes);

    long examinedCount();

    long affectedCount();

    long bytesFreedCount();

    /** Adds one item to the report's sample (a path, a hash, an id); ignored once {@value #MAX_SAMPLE} are kept. */
    void sample(String item);

    /** Adds one structured item (e.g. {@code {"sha": …, "size": …}}) to the report's sample, bounded like {@link #sample(String)}. */
    void sample(JsonNode item);

    /**
     * The run's structured report, merged into {@code system_job_run.report} when the run ends. The keys
     * {@code sample}, {@code sampleTotal} and {@code error} belong to the runner. Not thread-safe: fill it from the
     * job's own thread.
     */
    ObjectNode report();

    /** A short line on what the run is doing now ("Project 3 of 12: demo"); persisted with the lease renewal. */
    void progress(String message);

    /** Runs {@code work} in a new, short transaction and returns its result (one batch). */
    <T> T inTransaction(Supplier<T> work);

    /** Runs {@code work} in a new, short transaction (one batch). */
    void inTransaction(Runnable work);
}
