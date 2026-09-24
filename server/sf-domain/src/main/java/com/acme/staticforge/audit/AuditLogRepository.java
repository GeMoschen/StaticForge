package com.acme.staticforge.audit;

import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Appended-only audit trail (spec §26.3). Recent entries are ordered newest-first. */
public interface AuditLogRepository extends JpaRepository<AuditLog, Long> {

    List<AuditLog> findByProjectIdOrderByIdDesc(Long projectId, Pageable pageable);

    /**
     * Entries that may be about the account (M26 anonymize): {@code user:} targets it acted in, plus every
     * instance-level {@code USER_*} entry — the caller narrows those to the ones whose {@code detail.userId} matches
     * (JSON is read in Java so the query stays portable between PostgreSQL and H2).
     */
    @Query("select a from AuditLog a where a.target like 'user:%' and (a.actorUserId = :userId"
            + " or (a.projectId is null and a.action like 'USER\\_%' escape '\\'))")
    List<AuditLog> findUserTargetedCandidates(@Param("userId") Long userId);
}
