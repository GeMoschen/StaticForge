package com.acme.staticforge.scheduler;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ScheduledActionExecutionRepository extends JpaRepository<ScheduledActionExecution, Long> {

    /** The execution of {@code actionId} that hasn't finished — one waiting or interrupted by a lease expiry. */
    Optional<ScheduledActionExecution> findFirstByActionIdAndFinishedAtIsNullOrderByIdDesc(long actionId);

    /** The history of one action, newest first. */
    Page<ScheduledActionExecution> findByActionIdOrderByIdDesc(long actionId, Pageable pageable);

    /** The newest execution of each of {@code actionIds}. */
    @Query("""
            select e from ScheduledActionExecution e
            where e.id in (select max(x.id) from ScheduledActionExecution x where x.actionId in :actionIds group by x.actionId)
            """)
    List<ScheduledActionExecution> findLatest(@Param("actionIds") Collection<Long> actionIds);
}
