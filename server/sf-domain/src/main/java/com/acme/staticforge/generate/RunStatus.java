package com.acme.staticforge.generate;

/** Lifecycle state of a {@link GenerationRun} (spec §18.5). */
public enum RunStatus {
    QUEUED,
    RUNNING,
    SUCCESS,
    PARTIAL,
    FAILED,
    CANCELLED;

    /** Whether the run has finished and will emit no further progress. */
    public boolean isTerminal() {
        return this != QUEUED && this != RUNNING;
    }
}
