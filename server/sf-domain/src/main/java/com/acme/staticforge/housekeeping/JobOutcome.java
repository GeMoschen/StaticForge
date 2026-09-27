package com.acme.staticforge.housekeeping;

/** How a system job run ended (M29.1.1, epic decision 2); {@code null} on a run that is still going. */
public enum JobOutcome {
    /** Everything the job set out to do was done. */
    SUCCEEDED,
    /** The job threw, was cancelled (node shutdown, lost lease) or was interrupted by a crash. */
    FAILED,
    /** Some items were handled, others failed; the message and report say which. */
    PARTIAL,
    /** The job decided not to act this time (e.g. a search rebuild is in progress). */
    SKIPPED
}
