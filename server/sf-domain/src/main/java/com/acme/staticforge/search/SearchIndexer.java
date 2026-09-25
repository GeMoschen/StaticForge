package com.acme.staticforge.search;

import com.acme.staticforge.release.LocaleRelease;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetChange;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.search.extract.ExtractionContext;
import com.acme.staticforge.search.extract.IndexableAsset;
import com.acme.staticforge.search.extract.LiveExtractionContexts;
import com.acme.staticforge.search.extract.SearchTextExtractorRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Keeps each project's search index equal to the database (M23.2.1, M23.2.2). The database is the source of truth;
 * this only ever reads it.
 *
 * <p>There is one way an index moves forward, {@code sync}: it compares the index's revision stamp with the project's
 * newest revision and
 *
 * <ul>
 *   <li>rebuilds the index into a sibling directory and swaps it in when there is no index, it is unreadable, was
 *       written by another document model ({@link SearchSchemaVersion}) or another database, or lags more than
 *       {@code sf.search.catch-up-max-revisions};
 *   <li>then replays the revisions after the stamp: every asset their {@code summary.assets} lists, or that got a
 *       version in them, is upserted from its <em>current</em> version (or deleted), plus the pages and records whose
 *       template or dataset definition changed. The stamp advances to the newest revision R such that every revision
 *       up to R exists (the gapless counter) and none of its assets failed.
 * </ul>
 *
 * Revision commits ({@link SearchIndexingListener}), startup and the reindex endpoint all just request a sync. Syncs
 * run on virtual threads, one at a time per project, and coalesce: a request while one is queued adds nothing, so
 * the work queue is bounded by the number of projects. A request thread never waits for indexing. A lost request
 * (the app stopped between a commit and its sync) costs nothing but lag until the next sync.
 */
@Service
public class SearchIndexer implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(SearchIndexer.class);

    /** Assets loaded per query when replaying. */
    private static final int LOAD_CHUNK = 500;

    private final ReleaseStatusService releaseStatuses;
    private final SearchIndexService index;
    private final SearchTextExtractorRegistry extractors;
    private final LiveExtractionContexts contexts;
    private final ProjectRepository projects;
    private final RevisionRepository revisions;
    private final AssetRepository assets;
    private final AssetVersionRepository versions;
    private final AssetReferenceRepository references;
    private final SearchProperties properties;
    private final TransactionTemplate readOnly;
    private final MeterRegistry meters;
    private final Counter failures;
    private final Timer duration;
    private final ExecutorService executor =
            Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("sf-search-index-", 0).factory());
    private final Map<Long, ProjectState> states = new ConcurrentHashMap<>();
    private final Object idle = new Object();
    private int inFlight;

    public SearchIndexer(
            SearchIndexService index,
            SearchTextExtractorRegistry extractors,
            LiveExtractionContexts contexts,
            ProjectRepository projects,
            RevisionRepository revisions,
            AssetRepository assets,
            AssetVersionRepository versions,
            AssetReferenceRepository references,
            SearchProperties properties,
            PlatformTransactionManager transactionManager,
            MeterRegistry meters,
            ReleaseStatusService releaseStatuses) {
        this.releaseStatuses = releaseStatuses;
        this.index = index;
        this.extractors = extractors;
        this.contexts = contexts;
        this.projects = projects;
        this.revisions = revisions;
        this.assets = assets;
        this.versions = versions;
        this.references = references;
        this.properties = properties;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
        this.meters = meters;
        this.failures = Counter.builder("sf.search.index.failures")
                .description("Assets that could not be extracted or indexed (M23.2.1).")
                .register(meters);
        this.duration = Timer.builder("sf.search.index.duration")
                .description("Duration of one search index sync of a project (M23.2.1).")
                .register(meters);
    }

    /** Asks for the project's index to be brought up to date; returns at once. */
    public void requestSync(long projectId) {
        schedule(projectId);
    }

    /**
     * Asks for a full rebuild of the project's index followed by a catch-up; returns at once.
     *
     * @return {@code false} when a rebuild is already queued or running
     */
    public boolean requestRebuild(long projectId) {
        ProjectState state = state(projectId);
        if (state.rebuilding || !state.rebuildRequested.compareAndSet(false, true)) {
            return false;
        }
        schedule(projectId);
        return true;
    }

    /** The project's index state as of now. */
    public SearchStatus status(long projectId) {
        ProjectState state = state(projectId);
        Optional<ProjectInfo> info = project(projectId);
        long head = info.map(ProjectInfo::head).orElse(0L);
        IndexCheck check = index.check(projectId);
        Long indexed = info.isPresent() && check.current(info.get().owner())
                ? check.indexedRevision().getAsLong()
                : null;
        SearchStatus.State current;
        if (check.condition() == IndexCheck.Condition.UNAVAILABLE) {
            current = SearchStatus.State.UNAVAILABLE;
        } else if (state.rebuilding || state.rebuildRequested.get()) {
            current = SearchStatus.State.REBUILDING;
        } else if (indexed == null || indexed < head) {
            current = SearchStatus.State.CATCHING_UP;
        } else {
            current = SearchStatus.State.READY;
        }
        long lag = indexed == null ? head : Math.max(0, head - indexed);
        return new SearchStatus(indexed, head, lag, current, state.lastRebuildAt);
    }

    /** Waits until no sync is queued or running (tests, benchmarks). */
    public boolean awaitIdle(Duration timeout) throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        synchronized (idle) {
            while (inFlight > 0) {
                long left = deadline - System.nanoTime();
                if (left <= 0) {
                    return false;
                }
                TimeUnit.NANOSECONDS.timedWait(idle, left);
            }
            return true;
        }
    }

    @Override
    public void destroy() {
        executor.shutdownNow();
    }

    // ------------------------------------------------------------------ scheduling

    private static final class ProjectState {
        final ReentrantLock lock = new ReentrantLock();
        final AtomicBoolean pending = new AtomicBoolean();
        final AtomicBoolean rebuildRequested = new AtomicBoolean();
        final AtomicLong lag = new AtomicLong();
        volatile boolean rebuilding;
        volatile Instant lastRebuildAt;
    }

    private ProjectState state(long projectId) {
        return states.computeIfAbsent(projectId, id -> {
            ProjectState state = new ProjectState();
            Gauge.builder("sf.search.index.lag", state.lag, AtomicLong::get)
                    .description("Revisions a project's search index is behind (M23.2.1).")
                    .tag("project", Long.toString(id))
                    .register(meters);
            return state;
        });
    }

    private void schedule(long projectId) {
        ProjectState state = state(projectId);
        if (!state.pending.compareAndSet(false, true)) {
            return;
        }
        synchronized (idle) {
            inFlight++;
        }
        try {
            executor.execute(() -> run(projectId, state));
        } catch (RejectedExecutionException e) {
            state.pending.set(false);
            finished();
        }
    }

    private void run(long projectId, ProjectState state) {
        state.lock.lock();
        try {
            state.pending.set(false);
            boolean rebuild = state.rebuildRequested.get();
            if (rebuild) {
                state.rebuilding = true;
            }
            state.rebuildRequested.set(false);
            duration.record(() -> sync(projectId, state, rebuild));
        } catch (RuntimeException e) {
            log.error("Search index sync of project {} failed; the next sync retries", projectId, e);
        } finally {
            state.rebuilding = false;
            state.lock.unlock();
            finished();
        }
    }

    private void finished() {
        synchronized (idle) {
            inFlight--;
            idle.notifyAll();
        }
    }

    // ------------------------------------------------------------------ sync

    /** @param owner identifies the database state an index belongs to */
    private record ProjectInfo(boolean archived, String owner, long head) {}

    private Optional<ProjectInfo> project(long projectId) {
        return inReadOnly(() -> projects.findById(projectId).map(project -> new ProjectInfo(
                project.isArchived(), owner(project), revisions.findHeadRevisionId(projectId).orElse(0L))));
    }

    /** Identifies the database state an index belongs to: the project key and creation time. */
    public static String owner(Project project) {
        return project.getKey() + "@" + project.getCreatedAt().toEpochMilli();
    }

    private void sync(long projectId, ProjectState state, boolean forceRebuild) {
        Optional<ProjectInfo> found = project(projectId);
        if (found.isEmpty()) {
            return;
        }
        ProjectInfo info = found.get();
        if (info.archived()) {
            index.close(projectId);
            return;
        }
        IndexCheck check = index.check(projectId);
        if (check.condition() == IndexCheck.Condition.UNAVAILABLE) {
            return;
        }
        long head = info.head();
        String reason = forceRebuild ? "requested" : rebuildReason(check, info);
        long stamp;
        if (reason != null) {
            state.rebuilding = true;
            log.info("Rebuilding the search index of project {} ({})", projectId, reason);
            stamp = rebuild(projectId, head, info.owner());
            state.lastRebuildAt = Instant.now();
            state.rebuilding = false;
            head = project(projectId).map(ProjectInfo::head).orElse(head);
        } else {
            stamp = check.indexedRevision().getAsLong();
        }
        if (head > stamp) {
            stamp = replay(projectId, stamp, head, info.owner());
        }
        state.lag.set(Math.max(0, head - stamp));
    }

    /** Why the index can't be caught up by replay, or {@code null} when it can. */
    private String rebuildReason(IndexCheck check, ProjectInfo info) {
        return switch (check.condition()) {
            case MISSING -> "no index";
            case UNREADABLE -> "index unreadable";
            case UNAVAILABLE -> null;
            case PRESENT -> {
                if (check.schemaVersion().orElse(-1) != SearchSchemaVersion.CURRENT) {
                    yield "document model changed";
                }
                if (!check.current(info.owner())) {
                    yield "index belongs to another database";
                }
                long stamp = check.indexedRevision().getAsLong();
                if (stamp > info.head()) {
                    yield "index is ahead of the database";
                }
                if (info.head() - stamp > properties.catchUpMaxRevisions()) {
                    yield (info.head() - stamp) + " revisions behind";
                }
                yield null;
            }
        };
    }

    /** Rebuilds from every current version and swaps it in; returns the stamp written. */
    private long rebuild(long projectId, long head, String owner) {
        long started = System.nanoTime();
        List<Long> versionIds = inReadOnly(() -> versions.findCurrentVersionIdsByProject(projectId));
        long failedAt = Long.MAX_VALUE;
        int documents = 0;
        try (SearchIndexService.Rebuild rebuild = index.startRebuild(projectId)) {
            for (int from = 0; from < versionIds.size(); from += properties.rebuildBatchSize()) {
                List<Long> chunk = versionIds.subList(from, Math.min(versionIds.size(), from + properties.rebuildBatchSize()));
                BatchResult batch = inReadOnly(() -> {
                    ExtractionContext context = contexts.forPass(projectId);
                    long failed = Long.MAX_VALUE;
                    int added = 0;
                    List<AssetVersion> batchVersions = versions.findWithAssetByIdIn(chunk);
                    Map<Long, Map<String, LocaleRelease>> statuses = releaseStatuses.ofVersions(projectId, batchVersions);
                    for (AssetVersion version : batchVersions) {
                        // A version closed since the ids were read changed after `head`: the catch-up replays it.
                        if (version.getValidToRevision() != null || version.isDeleted()) {
                            continue;
                        }
                        try {
                            Optional<SearchDocument> document = extractors.extract(indexable(version.getAsset(), version), context)
                                    .map(d -> d.withReleaseStatuses(statusNames(statuses.get(version.getAssetId()))));
                            if (document.isPresent()) {
                                rebuild.add(document.get());
                                added++;
                            }
                        } catch (SfException e) {
                            throw e;
                        } catch (RuntimeException e) {
                            failed = Math.min(failed, version.getValidFromRevision());
                            failure(projectId, version.getValidFromRevision(), version.getAsset().getUuid(), e);
                        }
                    }
                    return new BatchResult(added, failed);
                });
                documents += batch.documents();
                failedAt = Math.min(failedAt, batch.failedAt());
            }
            long stamp = Math.min(head, failedAt - 1);
            rebuild.swap(stamp, owner);
            log.info(
                    "Rebuilt the search index of project {}: {} documents at revision {} in {} ms",
                    projectId,
                    documents,
                    stamp,
                    TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
            return stamp;
        }
    }

    private record BatchResult(int documents, long failedAt) {}

    /** Replays revisions {@code (from, to]}; returns the stamp committed. */
    private long replay(long projectId, long from, long to, String owner) {
        return inReadOnly(() -> {
            List<Revision> range = revisions.findByProjectIdAndRevisionIdBetweenOrderByRevisionIdAsc(projectId, from + 1, to);
            long contiguous = from;
            for (Revision revision : range) {
                if (revision.getRevisionId() != contiguous + 1) {
                    break;
                }
                contiguous = revision.getRevisionId();
            }
            if (contiguous == from) {
                return from;
            }

            // Every touched asset, with the first revision in the range that touched it.
            Map<Long, Long> firstRevision = new HashMap<>();
            Map<Long, Asset> touched = new LinkedHashMap<>();
            Map<UUID, Long> summaryUuids = new LinkedHashMap<>();
            for (Revision revision : range) {
                if (revision.getRevisionId() > contiguous) {
                    break;
                }
                for (JsonNode entry : revision.getSummary().path("assets")) {
                    parseUuid(entry.path("uuid").asText(null))
                            .ifPresent(uuid -> summaryUuids.merge(uuid, revision.getRevisionId(), Math::min));
                }
            }
            for (List<UUID> chunk : chunks(new ArrayList<>(summaryUuids.keySet()))) {
                for (Asset asset : assets.findByProjectIdAndUuidIn(projectId, chunk)) {
                    touched.put(asset.getId(), asset);
                    firstRevision.merge(asset.getId(), summaryUuids.get(asset.getUuid()), Math::min);
                }
            }
            Map<Long, Long> versioned = new HashMap<>();
            for (AssetChange change : versions.findFirstChangesBetween(projectId, from, contiguous)) {
                versioned.merge(change.assetId(), change.revision(), Math::min);
            }
            List<Long> missing = versioned.keySet().stream().filter(id -> !touched.containsKey(id)).toList();
            for (List<Long> chunk : chunks(missing)) {
                assets.findAllById(chunk).forEach(asset -> touched.put(asset.getId(), asset));
            }
            versioned.forEach((id, revision) -> firstRevision.merge(id, revision, Math::min));

            touched.putAll(cascade(from, touched.values(), firstRevision));
            long failedAt = apply(projectId, touched.values(), firstRevision);
            long stamp = Math.min(contiguous, failedAt - 1);
            index.commit(projectId, Math.max(from, stamp), owner);
            return Math.max(from, stamp);
        });
    }

    /**
     * Pages, records and child templates whose extraction depends on a touched template or dataset whose definition
     * (CDL, parent, deleted state) changed since {@code since}: over open reverse {@code TEMPLATE} edges and catalog
     * card {@code templateRef} edges, transitively through page templates extending a changed one. A renamed dataset
     * also re-indexes its record sets, whose documents carry the dataset's name (M25).
     */
    private Map<Long, Asset> cascade(long since, Collection<Asset> touched, Map<Long, Long> firstRevision) {
        Set<Long> seen = new HashSet<>();
        Deque<Asset> queue = new ArrayDeque<>();
        List<Asset> renamedDatasets = new ArrayList<>();
        for (Asset asset : touched) {
            seen.add(asset.getId());
            if (definesContent(asset.getAssetType()) && definitionChanged(asset, since)) {
                queue.add(asset);
            }
            if (asset.getAssetType() == AssetType.DATASET && nameChanged(asset, since)) {
                renamedDatasets.add(asset);
            }
        }
        Map<Long, Asset> dependents = new LinkedHashMap<>();
        while (!queue.isEmpty()) {
            Asset template = queue.poll();
            List<Long> referrers = references.findIncomingOpen(template.getId()).stream()
                    .filter(SearchIndexer::definitionEdge)
                    .map(AssetReference::getFromAssetId)
                    .filter(seen::add)
                    .toList();
            for (List<Long> chunk : chunks(referrers)) {
                for (Asset dependent : assets.findAllById(chunk)) {
                    dependents.put(dependent.getId(), dependent);
                    firstRevision.merge(dependent.getId(), firstRevision.getOrDefault(template.getId(), since + 1), Math::min);
                    if (dependent.getAssetType() == AssetType.PAGE_TEMPLATE) {
                        queue.add(dependent);
                    }
                }
            }
        }
        for (Asset dataset : renamedDatasets) {
            for (AssetVersion set : versions.findCurrentSetsOfDataset(dataset.getProjectId(), dataset.getId())) {
                if (seen.add(set.getAssetId())) {
                    dependents.put(set.getAssetId(), set.getAsset());
                    firstRevision.merge(set.getAssetId(), firstRevision.getOrDefault(dataset.getId(), since + 1), Math::min);
                }
            }
        }
        return dependents;
    }

    /** Whether the asset's display name differs from the one it had at {@code since} (a new asset: no). */
    private boolean nameChanged(Asset asset, long since) {
        Optional<AssetVersion> before = since == 0 ? Optional.empty() : versions.findValidAtRevision(asset.getId(), since);
        Optional<AssetVersion> now = versions.findByAssetIdAndValidToRevisionIsNull(asset.getId());
        return before.isPresent() && now.isPresent()
                && !Objects.equals(before.get().getDisplayName(), now.get().getDisplayName());
    }

    private static boolean definesContent(AssetType type) {
        return type == AssetType.PAGE_TEMPLATE || type == AssetType.SECTION_TEMPLATE || type == AssetType.DATASET;
    }

    private static boolean definitionEdge(AssetReference edge) {
        return edge.getKind() == ReferenceKind.TEMPLATE
                || (edge.getKind() == ReferenceKind.CONTENT_REF
                        && edge.getSourcePath() != null
                        && edge.getSourcePath().endsWith("templateRef"));
    }

    private boolean definitionChanged(Asset asset, long since) {
        Optional<AssetVersion> now = versions.findByAssetIdAndValidToRevisionIsNull(asset.getId());
        Optional<AssetVersion> before = since == 0 ? Optional.empty() : versions.findValidAtRevision(asset.getId(), since);
        if (before.isEmpty()) {
            // Created after the stamp: whatever uses it was written after it too, and is replayed itself.
            return false;
        }
        if (now.isEmpty()) {
            return true;
        }
        JsonNode a = before.get().getPayload();
        JsonNode b = now.get().getPayload();
        return before.get().isDeleted() != now.get().isDeleted()
                || !Objects.equals(a.path("contentDefinition").asText(""), b.path("contentDefinition").asText(""))
                || !Objects.equals(a.path("parentTemplateRef").asText(""), b.path("parentTemplateRef").asText(""));
    }

    /** Upserts or deletes each asset from its current version; returns the first revision of a failed asset. */
    private long apply(long projectId, Collection<Asset> touched, Map<Long, Long> firstRevision) {
        ExtractionContext context = contexts.forPass(projectId);
        Map<Long, AssetVersion> open = new HashMap<>();
        for (List<Long> chunk : chunks(touched.stream().map(Asset::getId).toList())) {
            versions.findOpenWithAssetByAssetIdIn(chunk).forEach(version -> open.put(version.getAssetId(), version));
        }
        Map<Long, Map<String, LocaleRelease>> statuses = releaseStatuses.ofVersions(projectId, open.values());
        long failedAt = Long.MAX_VALUE;
        for (Asset asset : touched) {
            try {
                AssetVersion version = open.get(asset.getId());
                Optional<SearchDocument> document = version == null || version.isDeleted()
                        ? Optional.empty()
                        : extractors.extract(indexable(asset, version), context)
                                .map(d -> d.withReleaseStatuses(statusNames(statuses.get(asset.getId()))));
                if (document.isPresent()) {
                    index.upsert(projectId, document.get());
                } else {
                    index.delete(projectId, asset.getUuid());
                }
            } catch (SfException e) {
                throw e;
            } catch (RuntimeException e) {
                long revision = firstRevision.getOrDefault(asset.getId(), Long.MAX_VALUE);
                failedAt = Math.min(failedAt, revision);
                failure(projectId, revision, asset.getUuid(), e);
            }
        }
        return failedAt;
    }

    /** The distinct release statuses over an asset's locales — what the {@code releaseStatus} filter matches (M27.1.3). */
    private static Set<String> statusNames(Map<String, LocaleRelease> locales) {
        if (locales == null) {
            return Set.of();
        }
        Set<String> names = new java.util.TreeSet<>();
        locales.values().forEach(release -> names.add(release.status().name()));
        return names;
    }

    private void failure(long projectId, long revision, UUID uuid, RuntimeException e) {
        failures.increment();
        log.warn("Search indexing failed for project {}, revision {}, asset {}", projectId, revision, uuid, e);
    }

    private static IndexableAsset indexable(Asset asset, AssetVersion version) {
        JsonNode payload = version.getPayload();
        String templateRef = switch (asset.getAssetType()) {
            case PAGE -> payload.path("templateRef").asText(null);
            case RECORD, RECORD_SET -> payload.path("datasetRef").asText(null);
            default -> null;
        };
        return new IndexableAsset(
                asset.getUuid(),
                asset.getAssetType(),
                asset.getUid(),
                version.getDisplayName(),
                version.getFolderPath(),
                parseUuid(templateRef).orElse(null),
                version.getValidFromRevision(),
                payload);
    }

    private static Optional<UUID> parseUuid(String value) {
        if (value == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(UUID.fromString(value));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private static <T> List<List<T>> chunks(List<T> items) {
        List<List<T>> chunks = new ArrayList<>();
        for (int from = 0; from < items.size(); from += LOAD_CHUNK) {
            chunks.add(items.subList(from, Math.min(items.size(), from + LOAD_CHUNK)));
        }
        return chunks;
    }

    private <T> T inReadOnly(Supplier<T> work) {
        return readOnly.execute(status -> work.get());
    }
}
