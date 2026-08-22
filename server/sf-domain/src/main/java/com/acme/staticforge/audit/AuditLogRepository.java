package com.acme.staticforge.audit;

import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Appended-only audit trail (spec §26.3). Recent entries are ordered newest-first. */
public interface AuditLogRepository extends JpaRepository<AuditLog, Long> {

    List<AuditLog> findByProjectIdOrderByIdDesc(Long projectId, Pageable pageable);
}
