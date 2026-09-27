package com.acme.staticforge.housekeeping;

/**
 * Thrown by {@link JobContext#checkCancelled()} when the run should stop: the node is shutting down or lost the job's
 * lease (M29.1.1). The runner records the run as {@link JobOutcome#FAILED} with the reason; work already committed in
 * earlier short transactions stays.
 */
public class JobCancelledException extends RuntimeException {

    public JobCancelledException(String reason) {
        super(reason);
    }
}
