package com.acme.staticforge.generate;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface GenerationRunRepository extends JpaRepository<GenerationRun, Long> {

    List<GenerationRun> findByProjectIdOrderByIdDesc(long projectId);

    @Query("""
            SELECT r FROM GenerationRun r
            WHERE r.projectId = :projectId
              AND (r.status = 'QUEUED' OR r.status = 'RUNNING')
            """)
    Optional<GenerationRun> findActive(@Param("projectId") long projectId);

    @Query("""
            SELECT r FROM GenerationRun r
            WHERE r.projectId = :projectId
              AND r.status = 'SUCCESS'
            ORDER BY r.id DESC
            """)
    List<GenerationRun> findRecentSuccesses(@Param("projectId") long projectId);
}
