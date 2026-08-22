package com.acme.staticforge.audit;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.springframework.data.domain.Pageable;

/**
 * Append-only audit trail (spec §26.3). Records security-relevant events that are not revisioned
 * content: authentication, membership changes, and channel/target administration. The {@code
 * projectId} is nullable for instance-level events (e.g. login) that have no project scope.
 */
public interface AuditService {

    /** Records one audit entry. {@code detail} may be {@code null} when the event has no context. */
    void record(Long projectId, Long actorUserId, String action, String target, JsonNode detail);

    /** Convenience overload for events without detail. */
    default void record(Long projectId, Long actorUserId, String action, String target) {
        record(projectId, actorUserId, action, target, null);
    }

    /** Most recent entries for a project, newest first. */
    List<AuditLog> findRecent(long projectId, Pageable pageable);
}
