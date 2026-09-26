package com.acme.staticforge.scheduler;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ScheduledActionRepository
        extends JpaRepository<ScheduledAction, Long>, JpaSpecificationExecutor<ScheduledAction> {

    /**
     * Claim candidates at {@code now}: active, due, not leased (or leased by a node whose lease expired — a crashed
     * node's {@code RUNNING} action), of a project that isn't archived (epic decision 26). Oldest due first.
     */
    @Query("""
            select a from ScheduledAction a, com.acme.staticforge.project.Project p
            where p.id = a.projectId and p.archived = false
              and a.status in :statuses and a.nextRunAt <= :now
              and (a.leaseUntil is null or a.leaseUntil < :now)
            order by a.nextRunAt, a.id
            """)
    List<ScheduledAction> findDue(
            @Param("now") Instant now, @Param("statuses") Collection<ActionStatus> statuses, Pageable limit);

    /** The action a project knows under {@code uuid} (M27.8.1: the one a re-import replaces). */
    Optional<ScheduledAction> findByProjectIdAndUuid(long projectId, UUID uuid);

    /** A project's actions in {@code statuses}, oldest first (M27.8.1: the open ones an export carries). */
    List<ScheduledAction> findByProjectIdAndStatusInOrderById(long projectId, Collection<ActionStatus> statuses);
}
