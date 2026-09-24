package com.acme.staticforge.audit;

import java.time.Instant;
import java.util.Set;
import org.springframework.data.domain.Page;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.springframework.data.domain.Pageable;

/**
 * Append-only audit trail (spec §26.3). Records security-relevant events that are not revisioned
 * content: authentication, membership changes, and channel/target administration. The {@code
 * projectId} is nullable for instance-level events (e.g. login) that have no project scope.
 *
 * <p>There is no purge job: the one-year retention of §26 is not enforced yet, so entries stay until an operator
 * removes them.
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

    /**
     * The instance-wide trail (M26, instance audit view): every entry matching {@code filter}, newest first
     * ({@code created_at}, then {@code id}, so paging is stable). The sort of {@code pageable} is ignored.
     */
    Page<AuditLog> search(AuditFilter filter, Pageable pageable);

    /** The distinct action names in the trail, alphabetically. */
    List<String> actions();

    /**
     * Optional filters of {@link #search}; {@code null} (or an empty {@code actions}) means "any".
     *
     * @param actions entries with one of these actions
     * @param actorUserId entries recorded for this actor
     * @param projectId entries of this project; ignored when {@code instanceOnly}
     * @param instanceOnly only entries without a project (login, user administration, …)
     * @param from entries at or after this instant
     * @param to entries strictly before this instant
     */
    record AuditFilter(
            Set<String> actions, Long actorUserId, Long projectId, boolean instanceOnly, Instant from, Instant to) {}

    /**
     * The one exception to append-only (M26, delete = anonymize): every entry about the account — those it acted in
     * with a {@code user:} target, and the instance-level {@code USER_*} entries whose {@code detail.userId} is it —
     * gets {@code anonymizedTarget}, and a rename's old and new names in {@code detail} are replaced as well. Entries
     * keep their action, actor id and time. {@code member:<id>} targets carry no name and stay.
     */
    void anonymizeUser(Long userId, String anonymizedTarget);
}
