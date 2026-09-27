package com.acme.staticforge.housekeeping;

import java.time.Instant;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SystemJobRunRepository extends JpaRepository<SystemJobRun, Long> {

    /** A job's history, newest first. */
    Page<SystemJobRun> findByJobKeyOrderByStartedAtDescIdDesc(String jobKey, Pageable pageable);

    /** The newest finished run of a job (the "last run" of the admin view). */
    Optional<SystemJobRun> findFirstByJobKeyAndFinishedAtIsNotNullOrderByStartedAtDescIdDesc(String jobKey);

    /**
     * When the job last did its work: the newest {@code SUCCEEDED} run that was not a dry run (the
     * {@code sf.job.last.success.age} gauge).
     */
    @Query("""
            select max(r.finishedAt) from SystemJobRun r
            where r.jobKey = :key and r.outcome = com.acme.staticforge.housekeeping.JobOutcome.SUCCEEDED
              and r.dryRun = false
            """)
    Instant findLastSuccess(@Param("key") String jobKey);

    /**
     * The id of the {@code keep + 1}-th newest run of a job: it and everything older fall out of the history
     * ({@link Pageable} of size 1 at offset {@code keep}).
     */
    @Query("select r.id from SystemJobRun r where r.jobKey = :key order by r.id desc")
    Page<Long> findIdsNewestFirst(@Param("key") String jobKey, Pageable pageable);

    @Modifying
    @Query("delete from SystemJobRun r where r.jobKey = :key and r.id <= :id")
    int deleteByJobKeyAndIdAtMost(@Param("key") String jobKey, @Param("id") long id);

    /** Closes the runs a crashed or cut-off node left open; how many there were. */
    @Modifying
    @Query("""
            update SystemJobRun r set r.finishedAt = :now,
                r.outcome = com.acme.staticforge.housekeeping.JobOutcome.FAILED, r.message = :message
            where r.jobKey = :key and r.finishedAt is null
            """)
    int failOpenRuns(@Param("key") String jobKey, @Param("now") Instant now, @Param("message") String message);
}
