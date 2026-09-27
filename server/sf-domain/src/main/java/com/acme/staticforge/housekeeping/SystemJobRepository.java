package com.acme.staticforge.housekeeping;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SystemJobRepository extends JpaRepository<SystemJob, String> {

    /**
     * Claim candidates at {@code now} among {@code keys} (the jobs a runner knows; orphaned rows never run): enabled,
     * due and not leased, or leased by a node whose lease expired. Earliest due first.
     */
    @Query("""
            select j from SystemJob j
            where j.key in :keys and j.enabled = true and j.nextRunAt <= :now
              and (j.leaseUntil is null or j.leaseUntil < :now)
            order by j.nextRunAt, j.key
            """)
    List<SystemJob> findDue(@Param("now") Instant now, @Param("keys") Collection<String> keys, Pageable limit);

    List<SystemJob> findAllByOrderByKey();
}
