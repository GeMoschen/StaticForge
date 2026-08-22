package com.acme.staticforge.revision;

/**
 * The mandatory revision context every mutating service method receives (spec §21.2).
 * Carries the project, the acting user and an optional comment so that no write path can
 * bypass revisioning.
 */
public record RevisionContext(long projectId, Long userId, String comment) {

    public static RevisionContext of(long projectId, Long userId, String comment) {
        return new RevisionContext(projectId, userId, comment);
    }
}
