package com.acme.staticforge.audit;

import com.acme.staticforge.revision.RevisionAware;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link AuditService} implementation. {@code record} uses the default {@code REQUIRED}
 * propagation: when invoked from a non-transactional caller (e.g. the auth login flow) it
 * commits immediately, so a subsequently-thrown error still leaves the audit entry; when
 * invoked inside a transactional service method it joins that unit of work and only commits
 * with it, so failed operations do not leave phantom "change" entries.
 */
@Service
@RevisionAware
public class AuditServiceImpl implements AuditService {

    private final AuditLogRepository repository;

    public AuditServiceImpl(AuditLogRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    public void record(Long projectId, Long actorUserId, String action, String target, JsonNode detail) {
        repository.save(new AuditLog(projectId, actorUserId, action, target, detail, Instant.now()));
    }

    @Override
    @Transactional(readOnly = true)
    public List<AuditLog> findRecent(long projectId, Pageable pageable) {
        return repository.findByProjectIdOrderByIdDesc(projectId, pageable);
    }
}
