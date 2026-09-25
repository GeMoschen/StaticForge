package com.acme.staticforge.scheduler;

/**
 * Lifecycle of a {@link ScheduledAction} (M27.4.1). A recurring action stays {@link #PENDING} between its slots; a
 * one-off ends in a terminal status. {@link #RUNNING} means a node holds the lease and is executing it; an action whose
 * execution waits for a busy project (epic decision 27) is {@link #PENDING} again between retries.
 */
public enum ActionStatus {
    PENDING,
    RUNNING,
    SUCCEEDED,
    /** Failed — for a recurring action this is "paused" ({@code next_run_at = null}) until someone takes it over. */
    FAILED,
    SKIPPED,
    CANCELLED;

    /** Whether the action is still scheduled (due now or later, or executing). */
    public boolean isActive() {
        return this == PENDING || this == RUNNING;
    }
}
