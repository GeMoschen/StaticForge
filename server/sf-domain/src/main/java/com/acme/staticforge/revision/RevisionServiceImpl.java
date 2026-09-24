package com.acme.staticforge.revision;

import com.acme.staticforge.project.ProjectWriteGuard;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link RevisionService} implementation. Allocation happens in the same transaction as
 * the write that triggered it, so a rollback leaves no gap (§7.3). The counter row lock
 * serializes writers per project only.
 *
 * <p>Every allocation publishes one {@link RevisionCommittedEvent}, delivered to after-commit listeners (search
 * indexing, M23.2.1); joining an open batch publishes nothing.
 *
 * <p>Allocation is also where an archived project turns read-only (M26): {@link #allocate} refuses it with
 * {@code 409 SF-DOM-0141} ({@link ProjectWriteGuard}), which covers every write that allocates a revision.
 */
@Service
@RevisionAware
public class RevisionServiceImpl implements RevisionService {

    private final RevisionCounterRepository counterRepository;
    private final RevisionRepository revisionRepository;
    private final ObjectMapper objectMapper;
    private final Counter allocateCounter;
    private final ApplicationEventPublisher events;
    private final ProjectWriteGuard writeGuard;

    public RevisionServiceImpl(
            RevisionCounterRepository counterRepository,
            RevisionRepository revisionRepository,
            ObjectMapper objectMapper,
            MeterRegistry meterRegistry,
            ApplicationEventPublisher events,
            ProjectWriteGuard writeGuard) {
        this.counterRepository = counterRepository;
        this.writeGuard = writeGuard;
        this.revisionRepository = revisionRepository;
        this.objectMapper = objectMapper;
        this.events = events;
        this.allocateCounter = Counter.builder("sf.revision.allocate")
                .description("Revisions allocated (spec §26.4).")
                .register(meterRegistry);
    }

    @Override
    @Transactional
    public Revision allocate(long projectId, ChangeType type, String comment, Long userId) {
        writeGuard.requireWritable(projectId);
        return record(projectId, type, comment, userId);
    }

    @Override
    @Transactional
    public Revision allocateEvenIfArchived(long projectId, ChangeType type, String comment, Long userId) {
        return record(projectId, type, comment, userId);
    }

    private Revision record(long projectId, ChangeType type, String comment, Long userId) {
        allocateCounter.increment();
        ObjectNode summary = objectMapper.createObjectNode();
        summary.putArray("assets");

        Revision revision = new Revision(
                projectId,
                counterRepository.nextRevision(projectId),
                Instant.now(),
                userId,
                type,
                comment,
                summary);
        Revision saved = revisionRepository.save(revision);
        events.publishEvent(new RevisionCommittedEvent(projectId, saved.getRevisionId()));
        return saved;
    }

    @Override
    @Transactional
    public Revision beginBatch(long projectId, ChangeType type, String comment, Long userId) {
        return allocate(projectId, type, comment, userId);
    }

    @Override
    @Transactional
    public Revision allocateOrJoin(RevisionContext ctx, ChangeType type) {
        if (ctx.openRevision() != null) {
            return ctx.openRevision();
        }
        return allocate(ctx.projectId(), type, ctx.comment(), ctx.userId());
    }

    @Override
    @Transactional
    public void appendSummary(long projectId, long revisionId, AssetChange change) {
        Revision revision = revisionRepository
                .findByProjectIdAndRevisionId(projectId, revisionId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "No revision " + revisionId + " for project " + projectId));

        ObjectNode summary = (ObjectNode) revision.getSummary();
        change.appendTo(summary);
        revision.setSummary(summary);
        revisionRepository.save(revision);
    }

    @Override
    @Transactional
    public void appendSummaries(long projectId, long revisionId, List<AssetChange> changes) {
        if (changes.isEmpty()) {
            return;
        }
        Revision revision = revisionRepository
                .findByProjectIdAndRevisionId(projectId, revisionId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "No revision " + revisionId + " for project " + projectId));

        ObjectNode summary = (ObjectNode) revision.getSummary();
        changes.forEach(change -> change.appendTo(summary));
        revision.setSummary(summary);
        revisionRepository.save(revision);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Revision> findRecent(long projectId, Pageable pageable) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(projectId, pageable);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Revision> findRecent(long projectId, Long since, Long userId, UUID assetUuid, Pageable pageable) {
        List<Revision> revisions = revisionRepository.findFiltered(projectId, since, userId);
        if (assetUuid != null) {
            String needle = assetUuid.toString();
            revisions = revisions.stream()
                    .filter(r -> summaryTouches(r.getSummary(), needle))
                    .toList();
        }
        return slice(revisions, pageable);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Revision> find(long projectId, long revisionId) {
        return revisionRepository.findByProjectIdAndRevisionId(projectId, revisionId);
    }

    private static boolean summaryTouches(com.fasterxml.jackson.databind.JsonNode summary, String uuid) {
        if (summary == null || !summary.has("assets")) {
            return false;
        }
        com.fasterxml.jackson.databind.JsonNode assets = summary.get("assets");
        if (!assets.isArray()) {
            return false;
        }
        for (com.fasterxml.jackson.databind.JsonNode entry : assets) {
            if (entry.has("uuid") && uuid.equals(entry.get("uuid").asText())) {
                return true;
            }
        }
        return false;
    }

    private static List<Revision> slice(List<Revision> revisions, Pageable pageable) {
        if (pageable == null || pageable.isUnpaged()) {
            return revisions;
        }
        long offset = pageable.getOffset();
        int limit = pageable.getPageSize();
        if (offset >= revisions.size()) {
            return List.of();
        }
        long to = Math.min(revisions.size(), offset + limit);
        return revisions.subList((int) offset, (int) to);
    }
}
