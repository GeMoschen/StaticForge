package com.acme.staticforge.generate.plan;

import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetUidHistoryRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.ReferenceRow;
import com.acme.staticforge.asset.dataset.RecordValues;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.generate.insight.RebuildEdgeKind;
import com.acme.staticforge.generate.insight.RebuildReason;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.generate.insight.RebuildStep;
import com.acme.staticforge.generate.render.SnapshotPagination;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.template.query.RecordView;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;
import org.springframework.stereotype.Service;

/**
 * Expands a set of changed assets to what an incremental build re-renders (spec §5.4, §18.2), and explains it
 * (M22.1.1). The one implementation of the walk: {@link BuildPlanner} uses it for real and dry-run plans, the asset
 * impact endpoint for a hypothetical change ({@link Changes#upperBound}).
 *
 * <p><b>Edges.</b> The walk follows the reverse edges of {@code asset_reference} valid at the snapshot revision,
 * loaded once as an in-memory index. Page → page-template and page → section-template edges are {@code TEMPLATE}
 * rows, so the index is the single source of structural and content dependencies. An edge that closed since the
 * baseline needs no index entry: it only closes when its {@code from} asset gets a new version, which already makes
 * that asset a change.
 *
 * <p><b>Where the walk stops.</b> It passes through non-page assets (media → template → pages, section template →
 * page template → pages) and from a <em>changed</em> page to the assets referencing it, but stops at a page that was
 * merely reached: a page's output depends on what it references, not on who references it. A reached page whose output
 * path moved since the base build (a template {@code outputPath} edit) keeps walking like a changed one, since every
 * link to it moved too.
 *
 * <p>Processed text media (M18.3.1) is the one kind of media with outgoing edges (its source's {@code OCTL_*}
 * references). Every processed media file the walk reaches, changed or reached, is collected for re-rendering. Like a
 * page, it stops the walk when it was merely reached: what links to it only carries its URL, which a change of its
 * dependencies never moves.
 *
 * <p>Datasets (M19.3.2): a template that loops {@code dataset:team} has an {@code OCTL_VALUE} edge to the dataset, a
 * record a {@code TEMPLATE} edge to it. The walk never goes from a dataset back into its records, so a record change
 * doesn't rebuild the pages that reference its siblings. Every record the walk visits continues to the templates
 * looping its dataset ({@link RebuildEdgeKind#DATASET_MEMBERSHIP}), but only to those with a loop whose
 * {@code folder}/{@code where} may select the record before or after the change ({@link DatasetLoopImpact}). A changed
 * dataset (its schema) still reaches every referrer.
 *
 * <p>Pagination (M21.2.1): a page paginating a navigation folder has a {@code CONTENT_REF} edge to it, but its output
 * also depends on the page references in the folder, which have no edge to it. Every page reference the walk visits
 * therefore reaches the pages paginating its folder, and a changed one also those paginating the folder it was in at
 * the baseline; a record reaches the pages paginating its dataset ({@link RebuildEdgeKind#PAGINATION_SOURCE}).
 *
 * <p><b>Navigation (§18.2).</b> {@code $CMS_NAVIGATION(nav:x)$} and {@code $CMS_FOR(i : nav:x)$} render folder
 * {@code x}'s whole subtree, but only {@code x} itself is an edge target. So a navigation-affecting change reaches the
 * navigation folders that render it, with edge {@link RebuildEdgeKind#NAVIGATION}, and their referrers walk as usual.
 * Navigation-affecting is:
 * <ul>
 *   <li>a changed {@code PAGE_REFERENCE} (created, moved, deleted, relabelled, reordered, retargeted): its navigation
 *       ancestor folders, where it is now and where it was at the baseline;</li>
 *   <li>a changed {@code FOLDER} of the Navigation store: its ancestors, now and at the baseline;</li>
 *   <li>a page reference pointing at a page whose navigation-visible state changed — created, deleted, display name
 *       (the label falls back to it), uid, or output path — or at a pages folder containing such a page (a folder
 *       entry resolves to its first navigable page). The changed page reaches its page references over their
 *       {@code NAV} rows, or its pages folders with edge {@code NAVIGATION}, and they continue as above.</li>
 * </ul>
 * A navigation folder reached this way only walks to templates and media (its page referrers paginate it, which only
 * direct members affect); a pages folder reached this way only to the page references pointing at it.
 *
 * <p><b>Reasons.</b> The walk is a breadth-first search seeded in UUID order whose neighbours are visited in a stable
 * order (referrer id, reference kind, source path), and every asset keeps the first edge it was discovered by. So the
 * parent pointers form a shortest-path tree and the chain of every reached asset is deterministic. Every discovered
 * edge is also kept, which gives {@link Result#causeCount} — the number of changed roots that reach an asset — without
 * a walk per root.
 */
@Service
public class RebuildExpansion {

    /** Asset ids per {@code IN} query, well below any database's bind-parameter limit. */
    private static final int ID_CHUNK = 1000;

    private static final Set<AssetType> BEFORE_TYPES =
            Set.of(AssetType.PAGE, AssetType.PAGE_REFERENCE, AssetType.FOLDER, AssetType.RECORD);

    private final AssetVersionRepository versions;
    private final AssetUidHistoryRepository uidHistory;
    private final AssetReferenceRepository references;

    public RebuildExpansion(
            AssetVersionRepository versions, AssetUidHistoryRepository uidHistory, AssetReferenceRepository references) {
        this.versions = versions;
        this.uidHistory = uidHistory;
        this.references = references;
    }

    /**
     * The changes between {@code baselineRevision} and the snapshot: every asset with a version or a uid change in
     * {@code (baseline, snapshot]}, with the newest revision it changed in, and the version it had at the baseline.
     *
     * @param outputMoved whether a page's output path differs from the base build's; always {@code false} without one
     */
    public Changes changesSince(Snapshot snapshot, long baselineRevision, Predicate<UUID> outputMoved) {
        Map<Long, Long> roots = new HashMap<>();
        Set<Long> uidChanged = new HashSet<>();
        versions.findChangesBetween(snapshot.projectId(), baselineRevision, snapshot.revision())
                .forEach(change -> roots.merge(change.assetId(), change.revision(), Math::max));
        uidHistory.findUidChangesBetween(snapshot.projectId(), baselineRevision, snapshot.revision()).forEach(change -> {
            roots.merge(change.assetId(), change.revision(), Math::max);
            uidChanged.add(change.assetId());
        });
        roots.keySet().removeIf(id -> snapshot.assetById(id) == null || snapshot.assetById(id).uuid() == null);

        List<Long> beforeIds = roots.keySet().stream()
                .filter(id -> BEFORE_TYPES.contains(snapshot.assetById(id).type()))
                .sorted()
                .toList();
        Map<Long, AssetVersion> before = new HashMap<>();
        for (int from = 0; from < beforeIds.size(); from += ID_CHUNK) {
            List<Long> chunk = beforeIds.subList(from, Math.min(from + ID_CHUNK, beforeIds.size()));
            for (AssetVersion version : versions.findValidAtRevisionByAssetIdIn(chunk, baselineRevision)) {
                before.put(version.getAssetId(), version);
            }
        }
        return new Changes(roots, before, uidChanged, outputMoved, false);
    }

    /** Walks {@code changes} over the snapshot's reference graph. */
    public Result expand(Snapshot snapshot, Changes changes, SnapshotPagination pagination) {
        return new Walk(snapshot, changes, pagination, references.findRowsValidAtByProject(snapshot.projectId(), snapshot.revision()))
                .run();
    }

    // ------------------------------------------------------------------
    // Changes
    // ------------------------------------------------------------------

    /**
     * The roots of a walk and what the walk needs to know about them.
     *
     * <p>A real plan's changes ({@link RebuildExpansion#changesSince}) compare with the baseline. The
     * {@link #upperBound} changes of an impact query assume the change matters to every reader: a record may start or
     * stop matching every loop over its dataset, a page change is navigation-affecting.
     */
    public static final class Changes {

        private final Map<Long, Long> roots;
        private final Map<Long, AssetVersion> before;
        private final Set<Long> uidChanged;
        private final Predicate<UUID> outputMoved;
        private final boolean upperBound;

        Changes(Map<Long, Long> roots, Map<Long, AssetVersion> before, Set<Long> uidChanged, Predicate<UUID> outputMoved,
                boolean upperBound) {
            this.roots = java.util.Collections.unmodifiableMap(new HashMap<>(roots)); // an upper bound has no revisions
            this.before = Map.copyOf(before);
            this.uidChanged = Set.copyOf(uidChanged);
            this.outputMoved = outputMoved == null ? uuid -> false : outputMoved;
            this.upperBound = upperBound;
        }

        /** A hypothetical change of {@code assetId}: everything it could rebuild. */
        public static Changes upperBound(long assetId) {
            Map<Long, Long> roots = new HashMap<>();
            roots.put(assetId, null);
            return new Changes(roots, Map.of(), Set.of(), uuid -> false, true);
        }

        boolean isRoot(long assetId) {
            return roots.containsKey(assetId);
        }

        Long revisionOf(long assetId) {
            return roots.get(assetId);
        }

        Set<Long> rootIds() {
            return roots.keySet();
        }

        AssetVersion before(long assetId) {
            return before.get(assetId);
        }

        boolean outputMoved(UUID pageUuid) {
            return outputMoved.test(pageUuid);
        }

        /** Whether a changed page's change shows in navigation: created, deleted, display name, uid or output path. */
        boolean navigationVisible(SnapshotAsset page) {
            if (upperBound) {
                return true;
            }
            AssetVersion previous = before.get(page.assetId());
            return previous == null
                    || previous.isDeleted() != page.deleted()
                    || !Objects.equals(previous.getDisplayName(), page.displayName())
                    || uidChanged.contains(page.assetId())
                    || outputMoved.test(page.uuid());
        }
    }

    // ------------------------------------------------------------------
    // Result
    // ------------------------------------------------------------------

    /** How an asset was first reached: from {@code parentId} over an edge. Roots have no discovery. */
    private record Discovery(long parentId, RebuildEdgeKind edge, ReferenceKind referenceKind, String sourcePath) {}

    /** What a walk reached and why. */
    public static final class Result {

        private final Snapshot snapshot;
        private final Changes changes;
        private final Set<UUID> pages;
        private final Set<UUID> processedMedia;
        private final Map<Long, Discovery> discoveries;
        private final Map<Long, List<Long>> successors;
        private final List<Long> roots;
        private Map<Long, BitSet> causes;

        private Result(
                Snapshot snapshot,
                Changes changes,
                Set<UUID> pages,
                Set<UUID> processedMedia,
                Map<Long, Discovery> discoveries,
                Map<Long, List<Long>> successors,
                List<Long> roots) {
            this.snapshot = snapshot;
            this.changes = changes;
            this.pages = pages;
            this.processedMedia = processedMedia;
            this.discoveries = discoveries;
            this.successors = successors;
            this.roots = roots;
        }

        /** Every page the walk reached, deleted ones included (their referrers had to drop their links). */
        public Set<UUID> pages() {
            return pages;
        }

        /** Every processed text media file the walk reached. */
        public Set<UUID> processedMedia() {
            return processedMedia;
        }

        /** The changed roots, as UUIDs, in walk order. */
        public Set<UUID> changedAssets() {
            Set<UUID> uuids = new LinkedHashSet<>();
            roots.forEach(id -> uuids.add(snapshot.assetById(id).uuid()));
            return uuids;
        }

        /** The newest revision each changed root changed in (none for an upper bound). */
        public Map<UUID, Long> changeRevisions() {
            Map<UUID, Long> revisions = new LinkedHashMap<>();
            roots.forEach(id -> {
                Long revision = changes.revisionOf(id);
                if (revision != null) {
                    revisions.put(snapshot.assetById(id).uuid(), revision);
                }
            });
            return revisions;
        }

        /** How many assets the walk reached, roots included. */
        public int reachedCount() {
            return roots.size() + (int) discoveries.keySet().stream().filter(id -> !changes.isRoot(id)).count();
        }

        /** Whether the walk reached {@code assetUuid}. */
        public boolean reached(UUID assetUuid) {
            SnapshotAsset asset = snapshot.assetByUuid(assetUuid);
            return asset != null && (changes.isRoot(asset.assetId()) || discoveries.containsKey(asset.assetId()));
        }

        /**
         * The shortest chain from {@code assetUuid} back to the change that reached it.
         *
         * @throws IllegalArgumentException when the walk didn't reach the asset
         */
        public RebuildReason reasonFor(UUID assetUuid) {
            if (!reached(assetUuid)) {
                throw new IllegalArgumentException("Asset " + assetUuid + " was not reached by the walk");
            }
            long id = snapshot.assetByUuid(assetUuid).assetId();
            List<RebuildStep> steps = new ArrayList<>();
            long current = id;
            while (!changes.isRoot(current)) {
                Discovery discovery = discoveries.get(current);
                SnapshotAsset asset = snapshot.assetById(current);
                steps.add(new RebuildStep(
                        asset.uuid(),
                        asset.type().name(),
                        asset.uid(),
                        discovery.edge(),
                        discovery.referenceKind() == null ? null : discovery.referenceKind().name(),
                        discovery.sourcePath()));
                current = discovery.parentId();
            }
            SnapshotAsset root = snapshot.assetById(current);
            return new RebuildReason(
                    root.deleted() ? RebuildRootKind.ASSET_DELETED : RebuildRootKind.ASSET_CHANGED,
                    root.uuid(),
                    root.type().name(),
                    root.uid(),
                    changes.revisionOf(current),
                    causeCount(id),
                    null,
                    steps);
        }

        /** The number of distinct changed roots from which the walk reaches {@code assetId}. */
        int causeCount(long assetId) {
            if (causes == null) {
                causes = propagateCauses();
            }
            BitSet bits = causes.get(assetId);
            return bits == null ? 1 : Math.max(1, bits.cardinality());
        }

        /** Each reached asset's set of roots: a fixpoint over the explored edges (bit sets only grow, so it ends). */
        private Map<Long, BitSet> propagateCauses() {
            Map<Long, BitSet> bits = new HashMap<>();
            Deque<Long> work = new ArrayDeque<>();
            for (int i = 0; i < roots.size(); i++) {
                BitSet own = new BitSet(roots.size());
                own.set(i);
                bits.put(roots.get(i), own);
                work.add(roots.get(i));
            }
            while (!work.isEmpty()) {
                long from = work.poll();
                BitSet source = bits.get(from);
                for (long to : successors.getOrDefault(from, List.of())) {
                    BitSet target = bits.computeIfAbsent(to, k -> new BitSet(roots.size()));
                    BitSet missing = (BitSet) source.clone();
                    missing.andNot(target);
                    if (!missing.isEmpty()) {
                        target.or(missing);
                        work.add(to);
                    }
                }
            }
            return bits;
        }
    }

    // ------------------------------------------------------------------
    // Walk
    // ------------------------------------------------------------------

    private static final Comparator<ReferenceRow> ROW_ORDER = Comparator.comparingLong(ReferenceRow::fromAssetId)
            .thenComparing(ReferenceRow::kind)
            .thenComparing(row -> row.sourcePath() == null ? "" : row.sourcePath());

    private static final class Walk {

        private final Snapshot snapshot;
        private final Changes changes;
        private final SnapshotPagination pagination;
        private final Map<Long, List<ReferenceRow>> referrers = new HashMap<>();
        private final Map<Long, List<Long>> navTargets = new HashMap<>();
        private final DatasetLoopImpact loops = new DatasetLoopImpact();

        private final Deque<Long> queue = new ArrayDeque<>();
        private final Map<Long, Discovery> discoveries = new HashMap<>();
        private final Map<Long, List<Long>> successors = new HashMap<>();
        private final Set<UUID> pages = new LinkedHashSet<>();
        private final Set<UUID> processedMedia = new LinkedHashSet<>();

        private Map<String, SnapshotAsset> foldersByPath;
        private Map<UUID, List<Long>> paginatorsBySource;
        private List<String> navigationVisiblePagePaths;

        Walk(Snapshot snapshot, Changes changes, SnapshotPagination pagination, List<ReferenceRow> rows) {
            this.snapshot = snapshot;
            this.changes = changes;
            this.pagination = pagination;
            for (ReferenceRow row : rows) {
                referrers.computeIfAbsent(row.toAssetId(), k -> new ArrayList<>()).add(row);
                if (row.kind() == ReferenceKind.NAV) {
                    navTargets.computeIfAbsent(row.fromAssetId(), k -> new ArrayList<>()).add(row.toAssetId());
                }
            }
            referrers.values().forEach(list -> list.sort(ROW_ORDER));
        }

        Result run() {
            List<Long> roots = changes.rootIds().stream()
                    .sorted(Comparator.comparing(id -> snapshot.assetById(id).uuid().toString()))
                    .toList();
            queue.addAll(roots);
            while (!queue.isEmpty()) {
                visit(queue.poll());
            }
            return new Result(snapshot, changes, pages, processedMedia, discoveries, successors, roots);
        }

        private void visit(long id) {
            SnapshotAsset asset = snapshot.assetById(id);
            if (asset == null) {
                return;
            }
            boolean changed = changes.isRoot(id);
            switch (asset.type()) {
                case PAGE -> {
                    pages.add(asset.uuid());
                    if (!changed && !changes.outputMoved(asset.uuid())) {
                        return;
                    }
                    if (changed && changes.navigationVisible(asset)) {
                        pagesFoldersPointedAt(asset).forEach(folder -> discover(folder, id, RebuildEdgeKind.NAVIGATION, null, null));
                    }
                }
                case MEDIA -> {
                    if (!asset.deleted() && TextMediaTypes.isProcessed(asset.payload())) {
                        processedMedia.add(asset.uuid());
                        if (!changed) {
                            return;
                        }
                    }
                }
                case RECORD -> readersSelecting(asset);
                case PAGE_REFERENCE -> {
                    AssetVersion before = changed ? changes.before(id) : null;
                    SnapshotAsset folder = folderAt(asset.folderPath());
                    discoverPaginators(folder, id);
                    if (before != null && !Objects.equals(before.getFolderPath(), asset.folderPath())) {
                        discoverPaginators(folderAt(before.getFolderPath()), id);
                    }
                    if (changed || pointsAtNavigationVisibleChange(id)) {
                        discoverNavigationAncestors(asset.folderPath(), true, id);
                        if (before != null) {
                            discoverNavigationAncestors(before.getFolderPath(), true, id);
                        }
                    }
                }
                case FOLDER -> {
                    boolean navigation = FolderScope.fromPayload(asset.payload()) == FolderScope.NAVIGATION;
                    if (!changed) {
                        walkReachedFolder(asset, navigation);
                        return;
                    }
                    if (navigation) {
                        discoverNavigationAncestors(asset.folderPath(), false, id);
                        AssetVersion before = changes.before(id);
                        if (before != null) {
                            discoverNavigationAncestors(before.getFolderPath(), false, id);
                        }
                    }
                }
                default -> {
                    // templates, global sets, datasets: every referrer
                }
            }
            boolean dataset = asset.type() == AssetType.DATASET;
            for (ReferenceRow row : referrers.getOrDefault(id, List.of())) {
                // A dataset's records reference it by datasetRef; walking back into them would rebuild every page that
                // reads any sibling record. Pages depend on the dataset through the templates that loop it.
                if (dataset && isType(row.fromAssetId(), AssetType.RECORD)) {
                    continue;
                }
                discoverOver(row, id);
            }
        }

        /**
         * A folder reached by the navigation rule: a navigation folder renders again for its templates and processed
         * media (its pages paginate it, which only direct members affect); a pages folder only matters to the page
         * references pointing at it.
         */
        private void walkReachedFolder(SnapshotAsset folder, boolean navigation) {
            for (ReferenceRow row : referrers.getOrDefault(folder.assetId(), List.of())) {
                boolean follow = navigation
                        ? !isType(row.fromAssetId(), AssetType.PAGE)
                        : row.kind() == ReferenceKind.NAV;
                if (follow) {
                    discoverOver(row, folder.assetId());
                }
            }
        }

        /**
         * Queues the readers of {@code record}'s dataset that may render it: templates with a loop that may select the
         * record's current or previous version (every loop for an upper bound), processed text media (its source can't
         * be analysed) and the pages paginating the dataset. The dataset's other referrers — its records, content
         * references to it — read no records.
         */
        private void readersSelecting(SnapshotAsset record) {
            UUID datasetUuid = RecordValues.datasetRef(record.payload());
            SnapshotAsset dataset = datasetUuid == null ? null : snapshot.assetByUuid(datasetUuid);
            if (dataset == null || changes.isRoot(dataset.assetId())) {
                return; // a changed dataset walks to all of its readers itself
            }
            List<RecordView> versions = new ArrayList<>(2);
            if (!record.deleted()) {
                versions.add(RecordValues.view(
                        record.uuid(), record.uid(), record.displayName(), record.folderPath(), record.changedAt(),
                        record.payload()));
            }
            AssetVersion before = changes.before(record.assetId());
            if (before != null && !before.isDeleted()) {
                versions.add(RecordValues.view(
                        record.uuid(), record.uid(), before.getDisplayName(), before.getFolderPath(), before.getChangedAt(),
                        before.getPayload()));
            }
            for (ReferenceRow row : referrers.getOrDefault(dataset.assetId(), List.of())) {
                SnapshotAsset reader = snapshot.assetById(row.fromAssetId());
                if (reader == null) {
                    continue;
                }
                switch (reader.type()) {
                    case SECTION_TEMPLATE, PAGE_TEMPLATE -> {
                        if (changes.upperBound || loops.affects(reader, dataset, versions)) {
                            discover(reader.assetId(), record.assetId(), RebuildEdgeKind.DATASET_MEMBERSHIP, null, dataset.uid());
                        }
                    }
                    case MEDIA -> discover(reader.assetId(), record.assetId(), RebuildEdgeKind.DATASET_MEMBERSHIP, null, dataset.uid());
                    case PAGE -> {
                        if (paginators(dataset.uuid()).contains(reader.assetId())) {
                            discover(reader.assetId(), record.assetId(), RebuildEdgeKind.PAGINATION_SOURCE, null, dataset.uid());
                        }
                    }
                    default -> {
                        // records and other referrers read no records
                    }
                }
            }
        }

        private void discoverPaginators(SnapshotAsset folder, long fromId) {
            if (folder != null) {
                paginators(folder.uuid()).forEach(page ->
                        discover(page, fromId, RebuildEdgeKind.PAGINATION_SOURCE, null, folder.uid()));
            }
        }

        /** Navigation folders on {@code path}: the folder at the path itself (when included) and all its ancestors. */
        private void discoverNavigationAncestors(String path, boolean includeSelf, long fromId) {
            for (String ancestor : ancestorPaths(path, includeSelf)) {
                SnapshotAsset folder = folderAt(ancestor);
                if (folder != null && folder.assetId() != fromId
                        && FolderScope.fromPayload(folder.payload()) == FolderScope.NAVIGATION) {
                    discover(folder.assetId(), fromId, RebuildEdgeKind.NAVIGATION, null, null);
                }
            }
        }

        /** Whether page reference {@code referenceId} points at a navigation-visible change: the page, or its pages folder. */
        private boolean pointsAtNavigationVisibleChange(long referenceId) {
            for (long targetId : navTargets.getOrDefault(referenceId, List.of())) {
                SnapshotAsset target = snapshot.assetById(targetId);
                if (target == null) {
                    continue;
                }
                if (target.type() == AssetType.PAGE && changes.isRoot(targetId) && changes.navigationVisible(target)) {
                    return true;
                }
                if (target.type() == AssetType.FOLDER) {
                    String prefix = normalize(target.folderPath());
                    if (navigationVisiblePagePaths().stream().anyMatch(path -> path.startsWith(prefix))) {
                        return true;
                    }
                }
            }
            return false;
        }

        /** The pages folders containing {@code page} that a page reference points at. */
        private List<Long> pagesFoldersPointedAt(SnapshotAsset page) {
            List<Long> folders = new ArrayList<>();
            for (String path : ancestorPaths(page.folderPath(), true)) {
                SnapshotAsset folder = folderAt(path);
                if (folder != null && referrers.getOrDefault(folder.assetId(), List.of()).stream()
                        .anyMatch(row -> row.kind() == ReferenceKind.NAV)) {
                    folders.add(folder.assetId());
                }
            }
            return folders;
        }

        private List<String> navigationVisiblePagePaths() {
            if (navigationVisiblePagePaths == null) {
                navigationVisiblePagePaths = changes.rootIds().stream()
                        .map(snapshot::assetById)
                        .filter(asset -> asset.type() == AssetType.PAGE && changes.navigationVisible(asset))
                        .map(asset -> normalize(asset.folderPath()))
                        .toList();
            }
            return navigationVisiblePagePaths;
        }

        private void discoverOver(ReferenceRow row, long toId) {
            SnapshotAsset from = snapshot.assetById(row.fromAssetId());
            RebuildEdgeKind edge = edgeOf(row, from);
            discover(
                    row.fromAssetId(),
                    toId,
                    edge,
                    edge == RebuildEdgeKind.REFERENCE ? row.kind() : null,
                    row.sourcePath());
        }

        private void discover(long id, long parentId, RebuildEdgeKind edge, ReferenceKind kind, String sourcePath) {
            if (id == parentId) {
                return;
            }
            successors.computeIfAbsent(parentId, k -> new ArrayList<>()).add(id);
            if (changes.isRoot(id) || discoveries.containsKey(id)) {
                return;
            }
            discoveries.put(id, new Discovery(parentId, edge, kind, sourcePath));
            queue.add(id);
        }

        /** The live pages paginating {@code sourceUuid}, by asset id. */
        private List<Long> paginators(UUID sourceUuid) {
            if (paginatorsBySource == null) {
                Map<UUID, List<Long>> index = new LinkedHashMap<>();
                snapshot.pages().stream()
                        .sorted(Comparator.comparingLong(SnapshotAsset::assetId))
                        .forEach(page -> pagination.valueOf(page).ifPresent(value ->
                                index.computeIfAbsent(value.sourceUuid(), k -> new ArrayList<>()).add(page.assetId())));
                paginatorsBySource = index;
            }
            return paginatorsBySource.getOrDefault(sourceUuid, List.of());
        }

        /** The live folder whose path is {@code path}. */
        private SnapshotAsset folderAt(String path) {
            if (path == null) {
                return null;
            }
            if (foldersByPath == null) {
                foldersByPath = new HashMap<>();
                for (SnapshotAsset folder : snapshot.assetsOfType(AssetType.FOLDER)) {
                    foldersByPath.put(normalize(folder.folderPath()), folder);
                }
            }
            return foldersByPath.get(normalize(path));
        }

        private boolean isType(long assetId, AssetType type) {
            SnapshotAsset asset = snapshot.assetById(assetId);
            return asset != null && asset.type() == type;
        }
    }

    /** {@code TEMPLATE} rows are named by where they are spelled; every other row is a generic reference. */
    static RebuildEdgeKind edgeOf(ReferenceRow row, SnapshotAsset from) {
        if (row.kind() != ReferenceKind.TEMPLATE || row.sourcePath() == null) {
            return RebuildEdgeKind.REFERENCE;
        }
        String path = row.sourcePath();
        if (path.equals("parentTemplateRef")) {
            return RebuildEdgeKind.PARENT_TEMPLATE;
        }
        if (from != null && from.type() == AssetType.PAGE) {
            if (path.equals("templateRef")) {
                return RebuildEdgeKind.PAGE_TEMPLATE;
            }
            if (path.startsWith("bodies.") && path.endsWith(".templateRef")) {
                return RebuildEdgeKind.SECTION_TEMPLATE;
            }
        }
        return RebuildEdgeKind.REFERENCE;
    }

    /** {@code "/a/b/"} → {@code "/a/b/", "/a/", "/"} (the first only when {@code includeSelf}). */
    static List<String> ancestorPaths(String path, boolean includeSelf) {
        List<String> paths = new ArrayList<>();
        String current = normalize(path);
        if (includeSelf) {
            paths.add(current);
        }
        while (!current.equals("/")) {
            String trimmed = current.substring(0, current.length() - 1);
            int slash = trimmed.lastIndexOf('/');
            current = slash <= 0 ? "/" : trimmed.substring(0, slash + 1);
            paths.add(current);
        }
        return paths;
    }

    static String normalize(String path) {
        if (path == null || path.isBlank()) {
            return "/";
        }
        return path.endsWith("/") ? path : path + "/";
    }
}
