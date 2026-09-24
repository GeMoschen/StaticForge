package com.acme.staticforge.audit;

import com.acme.staticforge.revision.RevisionAware;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import jakarta.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
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

    @Override
    @Transactional(readOnly = true)
    public Page<AuditLog> search(AuditFilter filter, Pageable pageable) {
        Pageable newestFirst = PageRequest.of(
                pageable.getPageNumber(),
                pageable.getPageSize(),
                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")));
        return repository.findAll(specification(filter), newestFirst);
    }

    @Override
    @Transactional(readOnly = true)
    public List<String> actions() {
        return repository.findDistinctActions();
    }

    private static Specification<AuditLog> specification(AuditFilter filter) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (filter.actions() != null && !filter.actions().isEmpty()) {
                predicates.add(root.get("action").in(filter.actions()));
            }
            if (filter.actorUserId() != null) {
                predicates.add(cb.equal(root.get("actorUserId"), filter.actorUserId()));
            }
            if (filter.instanceOnly()) {
                predicates.add(cb.isNull(root.get("projectId")));
            } else if (filter.projectId() != null) {
                predicates.add(cb.equal(root.get("projectId"), filter.projectId()));
            }
            if (filter.from() != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.<Instant>get("createdAt"), filter.from()));
            }
            if (filter.to() != null) {
                predicates.add(cb.lessThan(root.<Instant>get("createdAt"), filter.to()));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
    }

    private static final String USER_TARGET = "user:";

    @Override
    @Transactional
    public void anonymizeUser(Long userId, String anonymizedTarget) {
        String name = anonymizedTarget.startsWith(USER_TARGET) ? anonymizedTarget.substring(USER_TARGET.length()) : null;
        for (AuditLog entry : repository.findUserTargetedCandidates(userId)) {
            JsonNode detail = entry.getDetail();
            boolean about = userId.equals(entry.getActorUserId())
                    || (detail != null && detail.path("userId").asLong(Long.MIN_VALUE) == userId);
            if (!about) {
                continue;
            }
            JsonNode anonymizedDetail = detail;
            if (detail instanceof ObjectNode object && (object.has("from") || object.has("to"))) {
                ObjectNode copy = object.deepCopy();
                copy.put("from", name);
                copy.put("to", name);
                anonymizedDetail = copy;
            }
            entry.anonymize(anonymizedTarget, anonymizedDetail);
        }
    }
}
