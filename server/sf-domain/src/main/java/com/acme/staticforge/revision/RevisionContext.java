package com.acme.staticforge.revision;

/**
 * The mandatory revision context every mutating service method receives (spec §21.2).
 * Carries the project, the acting user and an optional comment so that no write path can
 * bypass revisioning.
 *
 * <p>{@code openRevision} is {@code null} for an ordinary standalone call (the common
 * case: one API mutation, one revision). When a caller is orchestrating several nested
 * service calls that together form one logical, user-facing operation (spec §7.1), it
 * opens a batch via {@link RevisionService#beginBatch} and builds a context carrying that
 * {@link Revision} here via {@link #joining}; every nested call that threads this same
 * context through {@link RevisionService#allocateOrJoin} then appends to the batch
 * instead of allocating its own revision.
 */
public record RevisionContext(long projectId, Long userId, String comment, Revision openRevision) {

    public static RevisionContext of(long projectId, Long userId, String comment) {
        return new RevisionContext(projectId, userId, comment, null);
    }

    /** Builds a context that carries an already-open batch revision for nested calls to join. */
    public static RevisionContext joining(Revision openRevision, Long userId, String comment) {
        return new RevisionContext(openRevision.getProjectId(), userId, comment, openRevision);
    }
}
