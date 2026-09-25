package com.acme.staticforge.scheduler;

/** What an action does when it is executed later than scheduled (epic decision 23). */
public enum MissedPolicy {
    /** Executes however late, recording the lateness. */
    RUN_LATE,
    /** Skips the slot when it is later than the action's {@code maxLateness}. */
    SKIP_IF_LATER_THAN
}
