package com.acme.staticforge.generate;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface GenerationRunRepository extends JpaRepository<GenerationRun, Long> {

    List<GenerationRun> findByProjectIdOrderByIdDesc(long projectId);

    @Query("""
            SELECT r FROM GenerationRun r
            WHERE r.projectId = :projectId
              AND (r.status = 'QUEUED' OR r.status = 'RUNNING')
            """)
    Optional<GenerationRun> findActive(@Param("projectId") long projectId);

    /** A run's id, status and times, without its JSON columns (M29.2.2 cleanup, M29.3.1 retention). */
    interface RunState {
        Long getId();

        String getStatus();

        Instant getStartedAt();

        Instant getFinishedAt();

        /** {@link RunStatus} of {@link #getStatus()}. */
        default RunStatus status() {
            return RunStatus.valueOf(getStatus());
        }
    }

    /** Every run of a project as a {@link RunState}, newest first. */
    @Query("""
            SELECT r.id AS id, r.status AS status, r.startedAt AS startedAt, r.finishedAt AS finishedAt
            FROM GenerationRun r
            WHERE r.projectId = :projectId
            ORDER BY r.id DESC
            """)
    List<RunState> findStatesByProjectId(@Param("projectId") long projectId);

    /** Every {@code QUEUED}/{@code RUNNING} run of the instance, oldest first (M29.2.1 recovery). */
    @Query("""
            SELECT r FROM GenerationRun r
            WHERE r.status = 'QUEUED' OR r.status = 'RUNNING'
            ORDER BY r.id
            """)
    List<GenerationRun> findAllActive();

    /**
     * The run, its row locked until the transaction ends ({@code SELECT … FOR UPDATE}, M29.2.1): every status change of
     * a queued or running run reads it this way, so a cancel, a recovery and the executor's final write (with its
     * publish) are serialized and each sees the others' committed status.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM GenerationRun r WHERE r.id = :id")
    Optional<GenerationRun> findByIdForUpdate(@Param("id") long id);

    /**
     * {@code QUEUED} → {@code RUNNING} as {@code node} (M29.2.1): sets the start time and the first heartbeat. A
     * compare-and-set: 0 when the run is no longer queued (cancelled or recovered before it started).
     */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE GenerationRun r
            SET r.status = 'RUNNING', r.startedAt = :now, r.executorNode = :node, r.heartbeatAt = :now
            WHERE r.id = :id AND r.status = 'QUEUED'
            """)
    int markRunning(@Param("id") long id, @Param("node") String node, @Param("now") Instant now);

    /**
     * Refreshes a running run's heartbeat (M29.2.1), a targeted update in its own transaction that touches nothing
     * else. 0 when the run is no longer {@code RUNNING}: it was cancelled or recovered, and its executor should stop.
     */
    @Transactional
    @Modifying
    @Query("UPDATE GenerationRun r SET r.heartbeatAt = :now WHERE r.id = :id AND r.status = 'RUNNING'")
    int heartbeat(@Param("id") long id, @Param("now") Instant now);
}
