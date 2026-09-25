package com.acme.staticforge.scheduler;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.time.Instant;

/**
 * One execution as a handler sees it (M27.4.1). A handler that may run again for the same slot (after a lease expiry,
 * or a retry while waiting) reads {@link #progress()} first and skips what is recorded there; it records a step with
 * {@link #checkpoint} inside the transaction that performs the step, so the step and its record commit together.
 */
public interface ExecutionContext {

    /** The action as stored. */
    ActionSpec spec();

    long actionId();

    long executionId();

    /** The slot being executed (the one-off time, the cron slot, or the "run now" instant). */
    Instant scheduledFor();

    /** The engine clock's current instant. */
    Instant now();

    /** How late the execution runs now ({@code now - scheduledFor}, never negative). */
    Duration lateBy();

    /**
     * {@code true} once the action's {@link MissedPolicy#SKIP_IF_LATER_THAN} bound has passed; always {@code false}
     * for {@link MissedPolicy#RUN_LATE}. The engine applies it when an execution starts; a handler that waits
     * re-checks it on each retry (epic decision 27).
     */
    boolean latenessBoundPassed();

    /** The user the action runs as — its owner, re-checked before this call (epic decision 25). */
    long ownerUserId();

    /** A copy of the progress recorded so far (empty on a first attempt). */
    ObjectNode progress();

    /**
     * Records {@code progress} (replacing the previous one), and the revision and generation run the execution produced
     * when not {@code null}. Joins the caller's transaction.
     */
    void checkpoint(ObjectNode progress, Long revisionId, Long generationRunId);
}
