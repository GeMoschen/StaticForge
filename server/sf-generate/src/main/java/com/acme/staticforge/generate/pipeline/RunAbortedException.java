package com.acme.staticforge.generate.pipeline;

/**
 * A generation run stops because it is no longer {@code RUNNING} (M29.2.1): it was cancelled, or the recovery job
 * failed it. Whoever changed the status also wrote it and told the listeners, so the executor writes nothing more; it
 * only lets go. Thrown by {@link RunCheckpoint#check()}; pipeline stages must let it propagate.
 */
public class RunAbortedException extends RuntimeException {

    private final long runId;

    public RunAbortedException(long runId) {
        super("Generation run " + runId + " is no longer running", null, false, false);
        this.runId = runId;
    }

    public long runId() {
        return runId;
    }
}
