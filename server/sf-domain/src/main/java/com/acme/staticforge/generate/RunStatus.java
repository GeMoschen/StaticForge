package com.acme.staticforge.generate;

/** Lifecycle state of a {@link GenerationRun} (spec §18.5). */
public enum RunStatus {
    QUEUED,
    RUNNING,
    SUCCESS,
    PARTIAL,
    FAILED,
    CANCELLED
}
