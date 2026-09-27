package com.acme.staticforge.housekeeping;

/**
 * What {@link HousekeepingJob#run} returns (M29.1.1): the outcome and an optional one-line message for the run history.
 * Counters, samples and structured report data go through {@link JobContext}. When {@code message} is {@code null},
 * the runner writes a summary of the counters ("Examined 12, affected 3, freed 4.2 MB.").
 */
public record JobResult(JobOutcome outcome, String message) {

    public JobResult {
        if (outcome == null) {
            throw new IllegalArgumentException("outcome is required");
        }
    }

    public static JobResult succeeded() {
        return new JobResult(JobOutcome.SUCCEEDED, null);
    }

    public static JobResult succeeded(String message) {
        return new JobResult(JobOutcome.SUCCEEDED, message);
    }

    public static JobResult partial(String message) {
        return new JobResult(JobOutcome.PARTIAL, message);
    }

    public static JobResult skipped(String message) {
        return new JobResult(JobOutcome.SKIPPED, message);
    }

    public static JobResult failed(String message) {
        return new JobResult(JobOutcome.FAILED, message);
    }
}
