package com.acme.staticforge.search;

import java.time.Instant;

/**
 * How current a project's search index is (M23.2.2).
 *
 * @param indexedRevision the revision the index is complete up to; {@code null} when there is no usable index
 * @param latestRevision the project's newest revision
 * @param lag revisions not yet indexed
 * @param lastRebuildAt when this instance last finished a full rebuild of the project, or {@code null}
 */
public record SearchStatus(Long indexedRevision, long latestRevision, long lag, State state, Instant lastRebuildAt) {

    public enum State {
        /** Up to date. */
        READY,
        /** Behind the latest revision; queries answer from the older state. */
        CATCHING_UP,
        /** A full rebuild is queued or running; queries answer from the previous index until the swap. */
        REBUILDING,
        /** The index can't be opened by this instance; search answers 503. */
        UNAVAILABLE
    }
}
