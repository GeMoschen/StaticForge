package com.acme.staticforge.revision;

/**
 * Allocates gapless, contention-safe revision ids per project (spec §7.3).
 * PostgreSQL uses a single {@code UPDATE … RETURNING} statement; other databases
 * (H2) use a {@code SELECT … FOR UPDATE} + {@code UPDATE} pair. Both share this
 * contract and are covered by the same tests.
 */
public interface RevisionCounterRepository {

    /** Allocates and returns the next revision id for the project. */
    long nextRevision(long projectId);

    /** Creates the counter row for a new project, starting at {@code next_revision = 1}. */
    void initialize(long projectId);
}
