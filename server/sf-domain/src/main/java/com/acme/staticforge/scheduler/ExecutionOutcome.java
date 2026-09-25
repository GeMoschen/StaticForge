package com.acme.staticforge.scheduler;

/** How one execution of a scheduled action ended (M27.4.1). */
public enum ExecutionOutcome {
    SUCCEEDED,
    /** Some items were applied, others were skipped with a reason (M27.4.2), or a follow-up step didn't run. */
    PARTIAL,
    FAILED,
    /** Not executed: too late for the missed policy (epic decision 23). */
    SKIPPED
}
