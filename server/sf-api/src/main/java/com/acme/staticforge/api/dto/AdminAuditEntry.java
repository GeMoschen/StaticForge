package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/**
 * One entry of the instance audit trail (M26). {@code projectKey} is {@code null} for instance-level entries;
 * {@code actor} is {@code null} for entries without one (a failed login for an unknown username).
 */
public record AdminAuditEntry(
        Long id, Instant timestamp, String action, Actor actor, String projectKey, String target, JsonNode detail) {

    /** Who acted; {@code username} is {@code Deleted user} for a deleted account. */
    public record Actor(Long id, String username) {}
}
