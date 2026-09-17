package com.acme.staticforge.revision;

/**
 * Published once per allocated revision (M23.2.1), inside the allocating transaction. Consumers listen after commit
 * ({@code @TransactionalEventListener(phase = AFTER_COMMIT)}), so a rolled-back transaction delivers nothing; joining
 * an open batch revision publishes no second event.
 */
public record RevisionCommittedEvent(long projectId, long revisionId) {}
