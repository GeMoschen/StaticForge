package com.acme.staticforge.revision;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RevisionRepository extends JpaRepository<Revision, Revision.RevisionId> {

    List<Revision> findByProjectIdOrderByRevisionIdDesc(Long projectId, Pageable pageable);

    List<Revision> findByProjectIdOrderByRevisionIdDesc(Long projectId);

    Optional<Revision> findByProjectIdAndRevisionId(Long projectId, Long revisionId);

    /**
     * Revision spine filtered by an incremental {@code since} cursor and/or author, newest first
     * (spec §20.2). The asset filter is applied in the service layer because it inspects the JSON
     * {@code summary}, which has no portable JSON-path predicate across H2 and PostgreSQL.
     */
    @Query("""
            SELECT r FROM Revision r
            WHERE r.projectId = :projectId
              AND (:since IS NULL OR r.revisionId > :since)
              AND (:userId IS NULL OR r.createdBy = :userId)
            ORDER BY r.revisionId DESC
            """)
    List<Revision> findFiltered(@Param("projectId") Long projectId,
            @Param("since") Long since, @Param("userId") Long userId);
}
