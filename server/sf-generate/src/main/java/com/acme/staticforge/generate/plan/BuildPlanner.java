package com.acme.staticforge.generate.plan;

import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.ReferenceEdge;
import com.acme.staticforge.asset.dataset.RecordValues;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.render.SnapshotPagination;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.pagination.PaginationSource;
import com.acme.staticforge.pagination.PaginationValue;
import com.acme.staticforge.template.query.RecordView;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Build planner (spec §18.3): turns a snapshot into an ordered {@link BuildPlan}. A FULL build
 * covers every page × each enabled channel; an INCREMENTAL build (mode {@code INCREMENTAL} with
 * a {@code lastSuccessfulRevision}) expands the set of assets changed since that revision over the
 * revision-valid reverse edges of {@code asset_reference}, and only renders the affected pages.
 *
 * <p>A paginated page (M21.2.1) is planned with every page number in every channel: its items are resolved once here
 * ({@link SnapshotPagination}) and handed to the renderer with the entries, so the count and the slices can't disagree.
 */
@Service
public class BuildPlanner {

    private static final Set<String> DEFAULT_CHANNELS = Set.of("html");

    /** Asset ids per {@code IN} query, well below any database's bind-parameter limit. */
    private static final int ID_CHUNK = 1000;

    private final AssetVersionRepository versions;
    private final AssetReferenceRepository references;
    private final CompiledTemplateCache compiledTemplates;

    public BuildPlanner(
            AssetVersionRepository versions, AssetReferenceRepository references, CompiledTemplateCache compiledTemplates) {
        this.versions = versions;
        this.references = references;
        this.compiledTemplates = compiledTemplates;
    }

    public BuildPlan plan(
            Snapshot snapshot,
            GenerationMode mode,
            Long lastSuccessfulRevision,
            Set<String> channels,
            String scopeFolderPath,
            Set<UUID> scopeAssetUuids,
            OutputPathResolver paths) {
        Set<String> effectiveChannels =
                channels == null || channels.isEmpty() ? DEFAULT_CHANNELS : Set.copyOf(channels);
        boolean incremental = mode == GenerationMode.INCREMENTAL && lastSuccessfulRevision != null;

        SnapshotPagination pagination = SnapshotPagination.of(snapshot, compiledTemplates.buildMemo(snapshot));
        Set<UUID> changedAssets = Set.of();
        Set<UUID> pageUuids;
        Set<UUID> processedMedia = Set.of();
        if (incremental) {
            changedAssets = changedAssets(snapshot, lastSuccessfulRevision);
            Affected affected = affected(snapshot, changedAssets, lastSuccessfulRevision, new Paginators(snapshot, pagination));
            pageUuids = affected.pages();
            processedMedia = affected.processedMedia();
        } else {
            pageUuids = new LinkedHashSet<>(snapshot.pages().stream().map(SnapshotAsset::uuid).toList());
        }

        List<PlanEntry> entries = new ArrayList<>();
        for (UUID pageUuid : sorted(pageUuids)) {
            SnapshotAsset page = snapshot.assetByUuid(pageUuid);
            if (page == null || page.deleted()) {
                // A deleted page is still walked for its referrers (they must drop their links) but never published.
                continue;
            }
            boolean inScope = inScope(page, scopeFolderPath, scopeAssetUuids);
            if (!inScope) {
                continue;
            }
            Optional<PaginationValue> paginated = pagination.valueOf(page);
            PaginationSource.Result items = paginated.map(pagination::items).orElse(null);
            for (String channel : sorted(effectiveChannels)) {
                String path = paths.resolvePagePath(pageUuid, channel);
                if (paginated.isEmpty()) {
                    entries.add(new PlanEntry(pageUuid, channel, path));
                    continue;
                }
                PaginatedPage paginatedPage = paginatedPage(pageUuid, channel, path, paginated.get(), items, paths);
                for (int number = 1; number <= paginatedPage.totalPages(); number++) {
                    entries.add(new PlanEntry(
                            pageUuid, channel, paginatedPage.path(number), new PlanEntry.Pagination(number, paginatedPage)));
                }
            }
        }
        entries.sort(Comparator.comparing(PlanEntry::outputPath)
                .thenComparingInt(PlanEntry::pageNumber)
                .thenComparing(PlanEntry::pageUuid));

        return new BuildPlan(incremental, snapshot.revision(), entries, changedAssets, processedMedia);
    }

    /** Every page's path in {@code channel}: page 1 at the page's own path, pages 2..N by the pagination pattern. */
    private static PaginatedPage paginatedPage(
            UUID pageUuid,
            String channel,
            String firstPath,
            PaginationValue value,
            PaginationSource.Result items,
            OutputPathResolver paths) {
        int total = PaginationSource.totalPages(items.items().size(), value.pageSize());
        List<String> pagePaths = new ArrayList<>(total);
        pagePaths.add(firstPath);
        for (int number = 2; number <= total; number++) {
            pagePaths.add(paths.resolvePaginationPath(pageUuid, channel, firstPath, number));
        }
        return new PaginatedPage(value.sourceUuid(), value.pageSize(), items.items(), pagePaths, items.warnings());
    }

    // ------------------------------------------------------------------
    // Changed assets + incremental expansion
    // ------------------------------------------------------------------

    /** Assets whose current version opened after {@code lastSuccessfulRevision}. */
    private Set<UUID> changedAssets(Snapshot snapshot, long lastSuccessfulRevision) {
        List<Long> changedIds = versions.findAssetIdsChangedSince(snapshot.projectId(), lastSuccessfulRevision);
        Set<UUID> changed = new LinkedHashSet<>();
        for (Long id : changedIds) {
            SnapshotAsset asset = snapshot.assetById(id);
            if (asset != null && asset.uuid() != null) {
                changed.add(asset.uuid());
            }
        }
        return changed;
    }

    /** What an incremental build re-renders: pages, and processed media outside any page render. */
    private record Affected(Set<UUID> pages, Set<UUID> processedMedia) {}

    /**
     * Expands changed assets to the affected pages over the reverse edges of {@code asset_reference}
     * (spec §5.4, §18.2), loaded once per plan as an in-memory reverse index. Page → page-template
     * and page → section-template edges are {@code TEMPLATE} rows, so the index is the single source
     * of structural and content dependencies.
     *
     * <p>The index holds the edges valid at the snapshot revision only. An edge that closed since the
     * last successful run needs no index entry: it only closes when its {@code from} asset gets a new
     * version, which already puts that asset into {@code changedAssets}.
     *
     * <p>The walk passes through non-page assets (media → template → pages, section template → page
     * template → pages) and from a <em>changed</em> page to the assets referencing it, but stops at a
     * page that was merely reached: a page's output depends on what it references, not on who
     * references it.
     *
     * <p>Processed text media (M18.3.1) is the one kind of media with outgoing edges (its source's
     * {@code OCTL_*} references). Every processed media file the walk reaches, changed or reached, is
     * collected for re-rendering. Like a page, it stops the walk when it was merely reached: what links
     * to it only carries its URL, which a change of its dependencies never moves. A changed processed
     * file keeps walking, exactly like any changed media.
     *
     * <p>Datasets (M19.3.2): a template that loops {@code dataset:team} has an {@code OCTL_VALUE} edge to
     * the dataset, a record a {@code TEMPLATE} edge to it. The walk never goes from a dataset back into
     * its records, so a record change doesn't rebuild the pages that reference its siblings. Every record
     * the walk visits — changed, or reached because it references a changed asset that its loop items
     * may dereference — continues to the templates looping its dataset, but only to those with a loop
     * whose {@code folder}/{@code where} may select the record before or after the change
     * ({@link DatasetLoopImpact}): a record a loop filters out in both versions leaves that loop's output
     * untouched. A changed dataset (its schema) still reaches every referrer.
     *
     * <p>Pagination (M21.2.1): a page paginating a navigation folder has a {@code CONTENT_REF} edge to it, but its
     * output also depends on the page references in the folder, which have no edge to it. Every page reference the
     * walk visits — changed, or reached because its target page changed — therefore queues the pages paginating its
     * folder, and a changed one also those paginating the folder it was in at the last run (a move or a delete takes
     * an item away). A record reaches the pages paginating its dataset like a template looping it. A paginated page is
     * always re-planned with all of its page numbers, since the count may have changed.
     *
     * <p>Render-time-only dependencies are not covered by persisted rows. A template's
     * {@code $CMS_NAVIGATION(nav:…)$} or {@code $CMS_FOR(x : nav:…)$} renders the folder's whole
     * subtree, but only the folder itself is an edge target, so a changed page reference deep in that
     * subtree does not reach the template. Expanding that is {@code M22.1.1}'s job (§18.2 navigation
     * rule); do not bring back generation-time reference inserts to cover it.
     */
    private Affected affected(Snapshot snapshot, Set<UUID> changedAssets, long lastSuccessfulRevision, Paginators paginators) {
        Map<Long, Set<Long>> referrers = new HashMap<>();
        for (ReferenceEdge edge : references.findValidAtByProject(snapshot.projectId(), snapshot.revision())) {
            referrers.computeIfAbsent(edge.toAssetId(), k -> new HashSet<>()).add(edge.fromAssetId());
        }

        Set<Long> changedIds = new HashSet<>();
        for (UUID changed : changedAssets) {
            SnapshotAsset asset = snapshot.assetByUuid(changed);
            if (asset != null) {
                changedIds.add(asset.assetId());
            }
        }

        Deque<Long> frontier = new ArrayDeque<>(changedIds);
        Map<Long, RecordView> recordsBefore = recordsBefore(snapshot, changedIds, lastSuccessfulRevision);
        Map<Long, Long> referenceFoldersBefore = referenceFoldersBefore(snapshot, changedIds, lastSuccessfulRevision);
        DatasetLoopImpact loops = new DatasetLoopImpact();
        Set<UUID> affected = new LinkedHashSet<>();
        Set<UUID> processedMedia = new LinkedHashSet<>();
        Set<Long> visited = new HashSet<>();
        while (!frontier.isEmpty()) {
            long id = frontier.poll();
            if (!visited.add(id)) {
                continue;
            }
            SnapshotAsset asset = snapshot.assetById(id);
            boolean page = asset != null && asset.type() == AssetType.PAGE;
            boolean processed = asset != null
                    && asset.type() == AssetType.MEDIA
                    && !asset.deleted()
                    && TextMediaTypes.isProcessed(asset.payload());
            if (page || processed) {
                (page ? affected : processedMedia).add(asset.uuid());
                if (!changedIds.contains(id)) {
                    continue;
                }
            }
            if (asset != null && asset.type() == AssetType.RECORD) {
                enqueueLoopsSelecting(
                        asset, recordsBefore.get(id), snapshot, referrers, changedIds, visited, frontier, loops, paginators);
            }
            if (asset != null && asset.type() == AssetType.PAGE_REFERENCE) {
                paginators.enqueueFor(paginators.folderOf(asset), frontier);
                Long before = referenceFoldersBefore.get(id);
                SnapshotAsset folderBefore = before == null ? null : snapshot.assetById(before);
                if (folderBefore != null) {
                    paginators.enqueueFor(folderBefore.uuid(), frontier);
                }
            }
            boolean dataset = asset != null && asset.type() == AssetType.DATASET;
            for (long fromId : referrers.getOrDefault(id, Set.of())) {
                if (visited.contains(fromId)) {
                    continue;
                }
                // A dataset's records reference it by datasetRef; walking back into them would rebuild
                // every page that reads any sibling record. Pages depend on the dataset through the
                // templates that loop it, which are the dataset's other referrers.
                if (dataset && isRecord(snapshot, fromId)) {
                    continue;
                }
                frontier.add(fromId);
            }
        }
        return new Affected(affected, processedMedia);
    }

    /**
     * Queues the readers of {@code record}'s dataset that may render it: templates with a loop that may
     * select the record's current or previous version, and processed text media (its source isn't in
     * the snapshot, so it can't be analysed). The dataset's other referrers — its records, content
     * references to it — read no records.
     */
    private static void enqueueLoopsSelecting(
            SnapshotAsset record,
            RecordView before,
            Snapshot snapshot,
            Map<Long, Set<Long>> referrers,
            Set<Long> changedIds,
            Set<Long> visited,
            Deque<Long> frontier,
            DatasetLoopImpact loops,
            Paginators paginators) {
        UUID datasetUuid = RecordValues.datasetRef(record.payload());
        SnapshotAsset dataset = datasetUuid == null ? null : snapshot.assetByUuid(datasetUuid);
        if (dataset == null || changedIds.contains(dataset.assetId())) {
            return; // a changed dataset walks to all of its readers itself
        }
        List<RecordView> versions = new ArrayList<>(2);
        if (!record.deleted()) {
            versions.add(RecordValues.view(
                    record.uuid(), record.uid(), record.displayName(), record.folderPath(), record.changedAt(), record.payload()));
        }
        if (before != null) {
            versions.add(before);
        }
        for (long readerId : referrers.getOrDefault(dataset.assetId(), Set.of())) {
            SnapshotAsset reader = snapshot.assetById(readerId);
            if (reader == null || visited.contains(readerId)) {
                continue;
            }
            boolean reads = switch (reader.type()) {
                case SECTION_TEMPLATE, PAGE_TEMPLATE -> loops.affects(reader, dataset, versions);
                case MEDIA -> true;
                case PAGE -> paginators.paginates(reader, dataset.uuid());
                default -> false;
            };
            if (reads) {
                frontier.add(readerId);
            }
        }
    }

    /** The versions the changed records had at {@code revision}; absent when created since or deleted then. */
    private Map<Long, RecordView> recordsBefore(Snapshot snapshot, Set<Long> changedIds, long revision) {
        List<Long> recordIds = changedIds.stream().filter(id -> isRecord(snapshot, id)).sorted().toList();
        Map<Long, RecordView> before = new HashMap<>();
        for (int from = 0; from < recordIds.size(); from += ID_CHUNK) {
            List<Long> chunk = recordIds.subList(from, Math.min(from + ID_CHUNK, recordIds.size()));
            for (AssetVersion version : versions.findValidAtRevisionByAssetIdIn(chunk, revision)) {
                SnapshotAsset record = snapshot.assetById(version.getAssetId());
                if (record != null && !version.isDeleted()) {
                    before.put(version.getAssetId(), RecordValues.view(
                            record.uuid(), record.uid(), version.getDisplayName(), version.getFolderPath(),
                            version.getChangedAt(), version.getPayload()));
                }
            }
        }
        return before;
    }

    /** The folder each changed page reference was in at {@code revision}; absent when created since. */
    private Map<Long, Long> referenceFoldersBefore(Snapshot snapshot, Set<Long> changedIds, long revision) {
        List<Long> referenceIds = changedIds.stream()
                .filter(id -> snapshot.assetById(id) != null && snapshot.assetById(id).type() == AssetType.PAGE_REFERENCE)
                .sorted()
                .toList();
        Map<Long, Long> before = new HashMap<>();
        for (int from = 0; from < referenceIds.size(); from += ID_CHUNK) {
            List<Long> chunk = referenceIds.subList(from, Math.min(from + ID_CHUNK, referenceIds.size()));
            for (AssetVersion version : versions.findValidAtRevisionByAssetIdIn(chunk, revision)) {
                if (version.getFolderId() != null) {
                    before.put(version.getAssetId(), version.getFolderId());
                }
            }
        }
        return before;
    }

    /**
     * Which pages paginate which source, and which folder holds a page reference, indexed once per incremental plan on
     * first use (M21.2.1).
     */
    private static final class Paginators {

        private final Snapshot snapshot;
        private final SnapshotPagination pagination;
        private Map<UUID, Set<Long>> pagesBySource;
        private Map<String, UUID> foldersByPath;

        Paginators(Snapshot snapshot, SnapshotPagination pagination) {
            this.snapshot = snapshot;
            this.pagination = pagination;
        }

        /** Queues every live page paginating {@code sourceUuid}. */
        void enqueueFor(UUID sourceUuid, Deque<Long> frontier) {
            if (sourceUuid != null) {
                frontier.addAll(pagesBySource().getOrDefault(sourceUuid, Set.of()));
            }
        }

        boolean paginates(SnapshotAsset page, UUID sourceUuid) {
            return pagesBySource().getOrDefault(sourceUuid, Set.of()).contains(page.assetId());
        }

        /** The folder a (non-folder) asset sits directly in, by its folder path. */
        UUID folderOf(SnapshotAsset asset) {
            if (foldersByPath == null) {
                foldersByPath = new HashMap<>();
                for (SnapshotAsset folder : snapshot.assetsOfType(AssetType.FOLDER)) {
                    foldersByPath.put(normalize(folder.folderPath()), folder.uuid());
                }
            }
            return foldersByPath.get(normalize(asset.folderPath()));
        }

        private Map<UUID, Set<Long>> pagesBySource() {
            if (pagesBySource == null) {
                pagesBySource = new HashMap<>();
                for (SnapshotAsset page : snapshot.pages()) {
                    pagination.valueOf(page).ifPresent(value ->
                            pagesBySource.computeIfAbsent(value.sourceUuid(), k -> new HashSet<>()).add(page.assetId()));
                }
            }
            return pagesBySource;
        }

        private static String normalize(String path) {
            if (path == null || path.isBlank()) {
                return "/";
            }
            return path.endsWith("/") ? path : path + "/";
        }
    }

    private static boolean isRecord(Snapshot snapshot, long assetId) {
        SnapshotAsset asset = snapshot.assetById(assetId);
        return asset != null && asset.type() == AssetType.RECORD;
    }

    private static boolean inScope(SnapshotAsset page, String scopeFolderPath, Set<UUID> scopeAssetUuids) {
        if (scopeAssetUuids != null && scopeAssetUuids.contains(page.uuid())) {
            return true;
        }
        if (scopeFolderPath == null || scopeFolderPath.isBlank()) {
            return true;
        }
        String folder = page.folderPath() == null ? "" : page.folderPath();
        String prefix = scopeFolderPath.endsWith("/") ? scopeFolderPath : scopeFolderPath + "/";
        return folder.equals(scopeFolderPath) || folder.startsWith(prefix);
    }

    private static <T> List<T> sorted(Set<T> values) {
        return values.stream().sorted(Comparator.comparing(v -> v.toString())).toList();
    }
}
