package com.acme.staticforge.revision;

import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.project.ProjectWriteGuard;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.persistence.criteria.Predicate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
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

    private static final char ESCAPE = '!';
    /** UUIDs per name lookup, below every database's bind-parameter limit. */
    private static final int NAME_LOOKUP_CHUNK = 1000;

    private final RevisionCounterRepository counterRepository;
    private final RevisionRepository revisionRepository;
    private final ObjectMapper objectMapper;
    private final Counter allocateCounter;
    private final ApplicationEventPublisher events;
    private final ProjectWriteGuard writeGuard;
    private final AssetVersionRepository assetVersionRepository;

    public RevisionServiceImpl(
            RevisionCounterRepository counterRepository,
            RevisionRepository revisionRepository,
            ObjectMapper objectMapper,
            MeterRegistry meterRegistry,
            ApplicationEventPublisher events,
            ProjectWriteGuard writeGuard,
            AssetVersionRepository assetVersionRepository) {
        this.assetVersionRepository = assetVersionRepository;
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
        int firstNew = summary.withArray("assets").size();
        change.appendTo(summary);
        nameNewEntries(projectId, revision, summary, firstNew);
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
        int firstNew = summary.withArray("assets").size();
        changes.forEach(change -> change.appendTo(summary));
        nameNewEntries(projectId, revision, summary, firstNew);
        revisionRepository.save(revision);
    }

    /**
     * Gives the entries appended at {@code firstNew} and later their item's display name (one lookup for all of them,
     * so {@code appendSummaries} stays a constant number of statements) and refreshes the revision's search text.
     * The name is the one the asset has now, i.e. as of this revision when its version is already written.
     */
    private void nameNewEntries(long projectId, Revision revision, ObjectNode summary, int firstNew) {
        ArrayNode assets = summary.withArray("assets");
        Map<UUID, ObjectNode> unnamed = new LinkedHashMap<>();
        for (int i = firstNew; i < assets.size(); i++) {
            ObjectNode entry = (ObjectNode) assets.get(i);
            UUID uuid = parseUuid(entry.path("uuid").asText(null));
            if (uuid != null && !entry.has("name")) {
                unnamed.put(uuid, entry);
            }
        }
        List<UUID> uuids = new ArrayList<>(unnamed.keySet());
        for (int from = 0; from < uuids.size(); from += NAME_LOOKUP_CHUNK) {
            List<UUID> chunk = uuids.subList(from, Math.min(uuids.size(), from + NAME_LOOKUP_CHUNK));
            for (Object[] row : assetVersionRepository.findOpenDisplayNames(projectId, chunk)) {
                unnamed.get((UUID) row[0]).put("name", (String) row[1]);
            }
        }
        revision.setSummary(summary);
        revision.setSearchText(searchText(summary));
    }

    private static String searchText(ObjectNode summary) {
        StringBuilder text = new StringBuilder();
        for (JsonNode entry : summary.withArray("assets")) {
            for (String field : List.of("name", "uid")) {
                if (entry.path(field).isTextual() && !entry.get(field).asText().isBlank()) {
                    text.append(entry.get(field).asText().toLowerCase(Locale.ROOT)).append('\n');
                }
            }
        }
        return text.length() == 0 ? null : text.substring(0, Math.min(text.length(), Revision.SEARCH_TEXT_LENGTH));
    }

    private static UUID parseUuid(String text) {
        try {
            return text == null ? null : UUID.fromString(text);
        } catch (IllegalArgumentException e) {
            return null; // not an asset entry (e.g. a membership change)
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<Revision> findRecent(long projectId, Pageable pageable) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(projectId, pageable);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Revision> findRecent(long projectId, Long since, Long userId, UUID assetUuid, Pageable pageable) {
        return search(projectId, RevisionFilter.of(since, userId, assetUuid), pageable).getContent();
    }

    @Override
    @Transactional(readOnly = true)
    public Page<Revision> search(long projectId, RevisionFilter filter, Pageable pageable) {
        Specification<Revision> spec = matching(projectId, filter);
        Sort newestFirst = Sort.by(Sort.Direction.DESC, "revisionId");
        if (pageable == null || pageable.isUnpaged()) {
            return new PageImpl<>(revisionRepository.findAll(spec, newestFirst));
        }
        return revisionRepository.findAll(spec, PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), newestFirst));
    }

    private static Specification<Revision> matching(long projectId, RevisionFilter f) {
        return (root, query, cb) -> {
            List<Predicate> all = new ArrayList<>();
            all.add(cb.equal(root.get("projectId"), projectId));
            if (f.since() != null) {
                all.add(cb.greaterThan(root.<Long>get("revisionId"), f.since()));
            }
            if (f.userId() != null) {
                all.add(cb.equal(root.get("createdBy"), f.userId()));
            }
            if (f.changeTypes() != null && !f.changeTypes().isEmpty()) {
                all.add(root.get("changeType").in(f.changeTypes().stream().map(Enum::name).toList()));
            }
            if (f.from() != null) {
                all.add(cb.greaterThanOrEqualTo(root.<Instant>get("createdAt"), f.from()));
            }
            if (f.to() != null) {
                all.add(cb.lessThan(root.<Instant>get("createdAt"), f.to()));
            }
            if (f.assetUuid() != null) {
                // The summary has no portable JSON-path predicate (H2 json, PostgreSQL jsonb): match the UUID's text,
                // which only ever occurs as an asset reference in the summary.
                all.add(cb.like(root.get("summary").as(String.class), "%" + f.assetUuid() + "%"));
            }
            if (f.q() != null && !f.q().isBlank()) {
                String pattern = "%" + escapeLike(f.q().strip().toLowerCase(Locale.ROOT)) + "%";
                all.add(cb.or(
                        cb.like(cb.lower(root.<String>get("comment")), pattern, ESCAPE),
                        cb.like(root.<String>get("searchText"), pattern, ESCAPE)));
            }
            return cb.and(all.toArray(Predicate[]::new));
        };
    }

    private static String escapeLike(String text) {
        return text.replace("" + ESCAPE, ESCAPE + "" + ESCAPE).replace("%", ESCAPE + "%").replace("_", ESCAPE + "_");
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Revision> find(long projectId, long revisionId) {
        return revisionRepository.findByProjectIdAndRevisionId(projectId, revisionId);
    }
}
