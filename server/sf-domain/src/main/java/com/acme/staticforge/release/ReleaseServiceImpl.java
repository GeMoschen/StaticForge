package com.acme.staticforge.release;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link ReleaseService} (M27.1.2). Every mutation resolves its items, checks them, and only then opens one batch
 * revision ({@link ChangeType#RELEASE}, {@link ChangeType#UNPUBLISH} or {@link ChangeType#DISCARD}), so a refusal
 * writes nothing and leaves the revision counter untouched.
 *
 * <p>Pointer rows follow the {@code asset_reference} discipline: a change closes the open row at the revision
 * ({@code valid_to_revision}) and, for a release, opens the new one at the same revision. Discard goes through the
 * asset services (restore, move, uid change, update) joined into the batch, so containment rules, folder paths and
 * reference rows stay exactly as every other write keeps them.
 *
 * <p><strong>Large selections</strong> (M27.1.4): resolving a selection, checking completeness and releasing cost a
 * fixed number of reads however many items there are — assets, drafts, pointers and versions are loaded in bulk
 * ({@link Chunks}), the completeness gate shares one {@link ReleaseCompleteness.Checker} per call, and the plan's
 * dependency walk queries edges and drafts once per breadth-first layer. Besides the round trips this matters for
 * the write paths: every query in a read-write transaction first auto-flushes, and Hibernate dirty-checks every
 * entity the transaction holds to do so — per-item queries made a 10,000-item release quadratic.
 */
@Service
@RevisionAware
public class ReleaseServiceImpl implements ReleaseService {

    private static final Set<ReleaseStatus> TO_PROPOSE =
            Set.of(ReleaseStatus.NEW, ReleaseStatus.CHANGED, ReleaseStatus.UNPUBLISHED);

    private final AssetRepository assetRepository;
    private final AssetVersionRepository versionRepository;
    private final AssetReferenceRepository referenceRepository;
    private final AssetReleaseRepository releaseRepository;
    private final ReleaseStatusService statusService;
    private final ReleaseCompleteness completeness;
    private final ReleasePermissionCheck permissions;
    private final ProjectLocales projectLocales;
    private final RevisionService revisionService;
    private final AssetService assetService;
    private final FolderService folderService;

    public ReleaseServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository versionRepository,
            AssetReferenceRepository referenceRepository,
            AssetReleaseRepository releaseRepository,
            ReleaseStatusService statusService,
            ReleaseCompleteness completeness,
            ReleasePermissionCheck permissions,
            ProjectLocales projectLocales,
            RevisionService revisionService,
            AssetService assetService,
            FolderService folderService) {
        this.assetRepository = assetRepository;
        this.versionRepository = versionRepository;
        this.referenceRepository = referenceRepository;
        this.releaseRepository = releaseRepository;
        this.statusService = statusService;
        this.completeness = completeness;
        this.permissions = permissions;
        this.projectLocales = projectLocales;
        this.revisionService = revisionService;
        this.assetService = assetService;
        this.folderService = folderService;
    }

    // ------------------------------------------------------------------
    // Dry run
    // ------------------------------------------------------------------

    // A refused plan writes nothing, so it must not doom a caller's transaction it joined: an import validates the
    // schedules of its archive with it and imports the rest when one is refused (M27.8.1).
    @Override
    @Transactional(readOnly = true, noRollbackFor = SfException.class)
    public ReleasePlan plan(long projectId, List<ReleaseItem> items) {
        Resolution resolution = resolve(projectId, items);
        ReleaseCompleteness.Checker checker = completeness.checker(projectId);
        List<ReleasePlan.Incomplete> incomplete = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        for (Resolved item : resolution.items()) {
            if (needsRelease(item)) {
                List<ContentIssue> issues = blocking(checker, item);
                if (!issues.isEmpty()) {
                    incomplete.add(new ReleasePlan.Incomplete(item.asset().getUuid(), item.key(), issues));
                }
            }
            if (item.pinned() != null && !item.pinned().getId().equals(item.draft().getId())) {
                warnings.add("'" + item.asset().getUid() + "' is pinned to an earlier version than its draft.");
            }
        }
        List<ReleasePlan.Dependency> dependencies = new Dependencies(projectId, resolution).propose();
        return new ReleasePlan(
                resolution.items().stream().map(Resolved::target).toList(), dependencies, incomplete, warnings);
    }

    // ------------------------------------------------------------------
    // Release
    // ------------------------------------------------------------------

    @Override
    @Transactional
    public ReleaseOutcome release(List<ReleaseItem> items, RevisionContext ctx) {
        permissions.requireRelease(ctx);
        Resolution resolution = resolve(ctx.projectId(), items);
        ReleaseCompleteness.Checker checker = completeness.checker(ctx.projectId());

        List<Resolved> toOpen = new ArrayList<>();
        List<Resolved> toClose = new ArrayList<>();
        List<ReleaseTarget> skipped = new ArrayList<>();
        List<Map<String, Object>> incomplete = new ArrayList<>();
        for (Resolved item : resolution.items()) {
            if (item.status() == ReleaseStatus.DELETION_PENDING) {
                toClose.add(item);
            } else if (needsRelease(item)) {
                List<ContentIssue> issues = blocking(checker, item);
                if (!issues.isEmpty()) {
                    incomplete.add(Map.of("uuid", item.asset().getUuid().toString(), "locale", item.key(), "issues", issues));
                }
                toOpen.add(item);
            } else {
                skipped.add(item.target());
            }
        }
        if (!incomplete.isEmpty()) {
            throw ReleaseProblems.incomplete(incomplete);
        }
        if (toOpen.isEmpty() && toClose.isEmpty()) {
            return new ReleaseOutcome(null, List.of(), skipped, List.of());
        }

        Revision revision = revisionService.beginBatch(ctx.projectId(), ChangeType.RELEASE, ctx.comment(), ctx.userId());
        long rev = revision.getRevisionId();
        Instant now = Instant.now();
        List<AssetRelease> closed = new ArrayList<>();
        List<AssetRelease> opened = new ArrayList<>();
        List<AssetChange> summary = new ArrayList<>();
        List<ReleaseTarget> applied = new ArrayList<>();
        for (Resolved item : toOpen) {
            close(item.pointer(), rev, closed);
            AssetVersion version = item.releaseVersion();
            opened.add(new AssetRelease(
                    ctx.projectId(), item.asset().getId(), item.key(), version.getId(), item.asset().getUid(), rev,
                    ctx.userId(), now));
            summary.add(AssetChange.release(item.asset().getUuid().toString(), item.asset().getAssetType().name(),
                    item.asset().getUid(), "RELEASE", item.key(), version.getId()));
            applied.add(item.target());
        }
        for (Resolved item : toClose) {
            close(item.pointer(), rev, closed);
            summary.add(AssetChange.release(item.asset().getUuid().toString(), item.asset().getAssetType().name(),
                    item.asset().getUid(), "UNPUBLISH", item.key(), null));
            applied.add(item.target());
        }
        releaseRepository.saveAll(closed);
        releaseRepository.saveAll(opened);
        revisionService.appendSummaries(ctx.projectId(), rev, summary);
        return new ReleaseOutcome(rev, applied, skipped, List.of());
    }

    // ------------------------------------------------------------------
    // Unpublish
    // ------------------------------------------------------------------

    @Override
    @Transactional
    public ReleaseOutcome unpublish(List<ReleaseItem> items, RevisionContext ctx) {
        permissions.requireUnpublish(ctx);
        Resolution resolution = resolve(ctx.projectId(), items);
        List<Resolved> toClose = resolution.items().stream().filter(i -> i.pointer() != null).toList();
        List<ReleaseTarget> skipped = resolution.items().stream()
                .filter(i -> i.pointer() == null)
                .map(Resolved::target)
                .toList();
        if (toClose.isEmpty()) {
            return new ReleaseOutcome(null, List.of(), skipped, List.of());
        }
        Revision revision = revisionService.beginBatch(ctx.projectId(), ChangeType.UNPUBLISH, ctx.comment(), ctx.userId());
        long rev = revision.getRevisionId();
        List<AssetChange> summary = new ArrayList<>();
        List<AssetRelease> closed = new ArrayList<>();
        for (Resolved item : toClose) {
            close(item.pointer(), rev, closed);
            summary.add(AssetChange.release(item.asset().getUuid().toString(), item.asset().getAssetType().name(),
                    item.asset().getUid(), "UNPUBLISH", item.key(), null));
        }
        releaseRepository.saveAll(closed);
        revisionService.appendSummaries(ctx.projectId(), rev, summary);
        return new ReleaseOutcome(rev, toClose.stream().map(Resolved::target).toList(), skipped, List.of());
    }

    // ------------------------------------------------------------------
    // Discard
    // ------------------------------------------------------------------

    @Override
    @Transactional
    public ReleaseOutcome discard(List<ReleaseItem> items, RevisionContext ctx) {
        permissions.requireDiscard(ctx);
        Resolution resolution = resolve(ctx.projectId(), items);

        List<Map<String, Object>> nothingReleased = new ArrayList<>();
        Map<Long, List<Resolved>> byAsset = new LinkedHashMap<>();
        List<ReleaseTarget> skipped = new ArrayList<>();
        for (Resolved item : resolution.items()) {
            if (item.pointer() == null) {
                nothingReleased.add(Map.of("uuid", item.asset().getUuid().toString(), "locale", item.key(),
                        "status", String.valueOf(item.status())));
            } else if (item.status() == ReleaseStatus.PUBLISHED) {
                skipped.add(item.target());
            } else {
                byAsset.computeIfAbsent(item.asset().getId(), id -> new ArrayList<>()).add(item);
            }
        }
        if (!nothingReleased.isEmpty()) {
            throw ReleaseProblems.nothingReleased(
                    "Nothing has been released to go back to; delete a new asset instead.", nothingReleased);
        }
        if (byAsset.isEmpty()) {
            return new ReleaseOutcome(null, List.of(), skipped, List.of());
        }

        Revision revision = revisionService.beginBatch(ctx.projectId(), ChangeType.DISCARD, ctx.comment(), ctx.userId());
        RevisionContext batch = RevisionContext.joining(revision, ctx.userId(), ctx.comment());
        LocaleConfig config = projectLocales.forProject(ctx.projectId());
        List<AssetChange> summary = new ArrayList<>();
        List<ReleaseTarget> applied = new ArrayList<>();
        List<ReleaseTarget> sharedKept = new ArrayList<>();
        for (List<Resolved> discarded : byAsset.values()) {
            Resolved first = discarded.get(0);
            Map<String, LocaleRelease> statuses = resolution.statuses().getOrDefault(first.asset().getId(), Map.of());
            if (isWholeDiscard(first, discarded, statuses)) {
                writeBack(first, batch);
            } else {
                sharedKept.addAll(discardLocales(first, discarded, batch, config));
            }
            for (Resolved item : discarded) {
                summary.add(AssetChange.release(item.asset().getUuid().toString(), item.asset().getAssetType().name(),
                        item.asset().getUid(), "DISCARD", item.key(), item.pointer().getReleasedVersionId()));
                applied.add(item.target());
            }
        }
        revisionService.appendSummaries(ctx.projectId(), revision.getRevisionId(), summary);
        return new ReleaseOutcome(revision.getRevisionId(), applied, skipped, sharedKept);
    }

    /**
     * {@code true} when discarding writes one released version back whole: the asset has one key, or a deleted or
     * structurally changed draft (a structure change touches every locale), or every locale either is discarded here
     * or is published against the same released version.
     */
    private static boolean isWholeDiscard(Resolved first, List<Resolved> discarded, Map<String, LocaleRelease> statuses) {
        if (ReleaseLocales.ALL.equals(first.key()) || first.draft().isDeleted()) {
            return true;
        }
        Long released = first.pointer().getReleasedVersionId();
        if (discarded.stream().anyMatch(i -> !i.pointer().getReleasedVersionId().equals(released))) {
            return false;
        }
        Set<String> discardedKeys = discarded.stream().map(Resolved::key).collect(Collectors.toSet());
        for (LocaleRelease other : statuses.values()) {
            if (discardedKeys.contains(other.localeKey())) {
                continue;
            }
            if (other.status() != ReleaseStatus.PUBLISHED || !released.equals(other.releasedVersionId())) {
                return false;
            }
        }
        return true;
    }

    /** Writes the released version of {@code item} back whole: uid, placement, name and payload. */
    private void writeBack(Resolved item, RevisionContext batch) {
        Asset asset = item.asset();
        AssetVersion released = item.releasedVersion();
        if (!Objects.equals(asset.getUid(), item.pointer().getReleasedUid())) {
            assetService.changeUid(asset.getUuid(), item.pointer().getReleasedUid(), batch);
        }
        if (asset.getAssetType() != AssetType.FOLDER || item.draft().isDeleted()) {
            // Restore writes the version valid at that revision — the released one — with its folder, containment
            // checks and record-set path rebasing, joined into the batch.
            assetService.restore(asset.getUuid(), released.getValidFromRevision(), batch);
            return;
        }
        // A folder moves through the folder service, which rewrites every descendant's path.
        if (!Objects.equals(released.getFolderId(), item.draft().getFolderId()) && released.getFolderId() != null) {
            UUID parent = assetRepository.findById(released.getFolderId()).map(Asset::getUuid).orElse(null);
            if (parent != null) {
                folderService.move(asset.getUuid(), parent, batch);
            }
        }
        AssetVersion current = versionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()).orElseThrow();
        if (!Objects.equals(current.getDisplayName(), released.getDisplayName())
                || !Objects.equals(current.getPayload(), released.getPayload())) {
            assetService.update(asset.getUuid(), new UpdateAssetCommand(released.getDisplayName(), released.getPayload()),
                    current.getValidFromRevision(), batch);
        }
    }

    /**
     * Restores the translations of the discarded locales, keeping the shared values and structure as drafted.
     * Returns the items whose locale still differs from its released state afterwards (shared values kept).
     */
    private List<ReleaseTarget> discardLocales(
            Resolved first, List<Resolved> discarded, RevisionContext batch, LocaleConfig config) {
        AssetVersion draft = first.draft();
        JsonNode payload = draft.getPayload();
        for (Resolved item : discarded) {
            payload = LocaleDiscard.merge(payload, item.releasedVersion().getPayload(), item.key());
            if (payload instanceof ObjectNode object) {
                // A localized media file is the locale's own too (M27.3.1).
                MediaFiles.restoreOwnFile(
                        object, item.releasedVersion().getPayload(), item.key(), config.effectiveChain(item.key()));
            }
        }
        if (!Objects.equals(payload, draft.getPayload())) {
            assetService.update(first.asset().getUuid(), new UpdateAssetCommand(draft.getDisplayName(), payload),
                    draft.getValidFromRevision(), batch);
        }
        AssetVersion written = versionRepository.findByAssetIdAndValidToRevisionIsNull(first.asset().getId()).orElseThrow();
        List<ReleaseTarget> kept = new ArrayList<>();
        for (Resolved item : discarded) {
            boolean same = LocaleProjection.project(written, first.asset().getUid(), item.key(), config)
                    .equals(LocaleProjection.project(item.releasedVersion(), item.pointer().getReleasedUid(), item.key(), config));
            if (!same) {
                kept.add(item.target());
            }
        }
        return kept;
    }

    // ------------------------------------------------------------------
    // Resolution
    // ------------------------------------------------------------------

    private record Resolved(
            Asset asset,
            AssetVersion draft,
            String key,
            AssetRelease pointer,
            ReleaseStatus status,
            AssetVersion pinned,
            AssetVersion releasedVersion) {

        AssetVersion releaseVersion() {
            return pinned != null ? pinned : draft;
        }

        ReleaseTarget target() {
            AssetVersion version = draft.isDeleted() && pinned == null ? null : releaseVersion();
            return new ReleaseTarget(asset.getUuid(), asset.getAssetType(), asset.getUid(), draft.getDisplayName(), key,
                    status, version == null ? null : version.getId());
        }
    }

    private record Resolution(List<Resolved> items, Map<Long, Map<String, LocaleRelease>> statuses) {}

    private Resolution resolve(long projectId, List<ReleaseItem> items) {
        if (items == null || items.isEmpty()) {
            throw ReleaseProblems.emptySelection();
        }
        LocaleConfig config = projectLocales.forProject(projectId);
        Set<UUID> uuids = new LinkedHashSet<>();
        Set<Long> pinnedIds = new HashSet<>();
        for (ReleaseItem item : items) {
            if (item == null || item.assetUuid() == null) {
                throw ReleaseProblems.unknownItem("Every item needs an asset.");
            }
            uuids.add(item.assetUuid());
            if (item.pinnedVersionId() != null) {
                pinnedIds.add(item.pinnedVersionId());
            }
        }
        // Everything the selection needs, in bulk: a read per asset would make a large release quadratic (class comment).
        Map<UUID, Asset> byUuid = new HashMap<>();
        Chunks.flatMap(uuids, chunk -> assetRepository.findByProjectIdAndUuidIn(projectId, chunk))
                .forEach(asset -> byUuid.put(asset.getUuid(), asset));
        Map<Long, AssetVersion> openVersions = new HashMap<>();
        Set<Long> assetIds = byUuid.values().stream().map(Asset::getId).collect(Collectors.toSet());
        if (!assetIds.isEmpty()) {
            Chunks.flatMap(assetIds, versionRepository::findOpenWithAssetByAssetIdIn)
                    .forEach(version -> openVersions.put(version.getAssetId(), version));
        }
        Map<Long, AssetVersion> pinnedVersions = new HashMap<>();
        if (!pinnedIds.isEmpty()) {
            Chunks.flatMap(pinnedIds, versionRepository::findAllById).forEach(v -> pinnedVersions.put(v.getId(), v));
        }

        Map<UUID, Asset> assets = new LinkedHashMap<>();
        Map<Long, AssetVersion> drafts = new HashMap<>();
        for (UUID uuid : uuids) {
            Asset asset = byUuid.get(uuid);
            if (asset == null) {
                throw ReleaseProblems.unknownItem("Asset " + uuid + " not found.");
            }
            AssetVersion draft = openVersions.get(asset.getId());
            if (draft == null) {
                throw ReleaseProblems.unknownItem("Asset " + asset.getUuid() + " has no version.");
            }
            if (!ReleasableTypes.isReleasable(asset.getAssetType(), draft.getPayload(), asset.getUid())) {
                throw ReleaseProblems.unknownItem(
                        "'" + asset.getUid() + "' (" + asset.getAssetType() + ") has no release state: it is always live.");
            }
            assets.put(uuid, asset);
            drafts.put(asset.getId(), draft);
        }
        Map<Long, Map<String, LocaleRelease>> statuses = statusService.of(projectId,
                assets.values().stream().map(a -> new ReleaseStatusService.Draft(a, drafts.get(a.getId()))).toList());
        Map<Long, AssetRelease> pointersById = new HashMap<>();
        Chunks.flatMap(drafts.keySet(), releaseRepository::findByAssetIdInAndValidToRevisionIsNull)
                .forEach(p -> pointersById.put(p.getId(), p));
        Map<String, AssetRelease> openPointers = new HashMap<>();
        pointersById.values().forEach(p -> openPointers.put(p.getAssetId() + "|" + p.getLocaleKey(), p));
        Map<Long, AssetVersion> releasedVersions = new HashMap<>();
        Set<Long> releasedIds = pointersById.values().stream().map(AssetRelease::getReleasedVersionId).collect(Collectors.toSet());
        if (!releasedIds.isEmpty()) {
            Chunks.flatMap(releasedIds, versionRepository::findAllById).forEach(v -> releasedVersions.put(v.getId(), v));
        }

        Map<String, Resolved> resolved = new LinkedHashMap<>();
        for (ReleaseItem item : items) {
            Asset asset = assets.get(item.assetUuid());
            AssetVersion draft = drafts.get(asset.getId());
            List<String> keys = ReleaseLocales.keysFor(config, asset.getAssetType(), draft.getPayload());
            List<String> selected = selectKeys(item, keys, config, asset);
            AssetVersion pinned = pinnedVersion(item, asset, pinnedVersions);
            for (String key : selected) {
                LocaleRelease status = statuses.getOrDefault(asset.getId(), Map.of()).get(key);
                AssetRelease pointer = openPointers.get(asset.getId() + "|" + key);
                resolved.putIfAbsent(asset.getId() + "|" + key, new Resolved(
                        asset,
                        draft,
                        key,
                        pointer,
                        status == null ? null : status.status(),
                        pinned,
                        pointer == null ? null : releasedVersions.get(pointer.getReleasedVersionId())));
            }
        }
        return new Resolution(List.copyOf(resolved.values()), statuses);
    }

    private static List<String> selectKeys(ReleaseItem item, List<String> keys, LocaleConfig config, Asset asset) {
        if (item.locale() == null) {
            return keys;
        }
        if (keys.contains(item.locale())) {
            return List.of(item.locale());
        }
        String declared = config.canonicalDeclared(item.locale());
        if (declared != null && keys.contains(declared)) {
            return List.of(declared);
        }
        if (declared != null && keys.equals(List.of(ReleaseLocales.ALL))) {
            return keys;
        }
        throw ReleaseProblems.unknownItem("'" + asset.getUid() + "' has no locale '" + item.locale() + "'.");
    }

    private static AssetVersion pinnedVersion(ReleaseItem item, Asset asset, Map<Long, AssetVersion> pinnedVersions) {
        if (item.pinnedVersionId() == null) {
            return null;
        }
        AssetVersion pinned = Optional.ofNullable(pinnedVersions.get(item.pinnedVersionId()))
                .filter(v -> v.getAssetId().equals(asset.getId()))
                .orElseThrow(() -> ReleaseProblems.foreignVersion(
                        "Version " + item.pinnedVersionId() + " is not a version of '" + asset.getUid() + "'."));
        if (pinned.isDeleted()) {
            throw ReleaseProblems.foreignVersion("Version " + item.pinnedVersionId() + " is a deletion; unpublish instead.");
        }
        return pinned;
    }

    /** {@code true} when releasing {@code item} opens a pointer (it isn't published at the version it would get). */
    private static boolean needsRelease(Resolved item) {
        if (item.status() == null || item.status() == ReleaseStatus.DELETION_PENDING || item.draft().isDeleted() && item.pinned() == null) {
            return false;
        }
        if (item.status() != ReleaseStatus.PUBLISHED) {
            return true;
        }
        return item.pinned() != null && !item.pinned().getId().equals(item.pointer().getReleasedVersionId());
    }

    private static List<ContentIssue> blocking(ReleaseCompleteness.Checker checker, Resolved item) {
        return checker.blockingIssues(item.asset().getAssetType(), item.releaseVersion());
    }

    /** Closes {@code pointer} at {@code revision} when it is open, collecting it for one {@code saveAll}. */
    private static void close(AssetRelease pointer, long revision, List<AssetRelease> closed) {
        if (pointer != null && pointer.isOpen()) {
            pointer.setValidToRevision(revision);
            closed.add(pointer);
        }
    }

    // ------------------------------------------------------------------
    // Dependency closure (epic decision 9)
    // ------------------------------------------------------------------

    /**
     * Breadth-first over what the selection needs: the targets of the drafts' open reference edges, the folders and
     * record sets they sit in, the records of a selected set, and — offered, not preselected — the changed
     * descendants of a selected, changed folder. A dependency is proposed in the same locale (or under the shared key
     * of non-localized media) when it isn't released there yet or has unreleased changes; containers only when they
     * aren't released at all. Each asset and locale is visited once, so cycles end.
     */
    private final class Dependencies {

        private final long projectId;
        private final LocaleConfig config;
        private final Set<String> selected = new HashSet<>();
        private final Map<String, ReleasePlan.Dependency> proposed = new LinkedHashMap<>();
        private final Map<Long, Optional<Draft>> drafts = new HashMap<>();
        private final Deque<Node> queue = new ArrayDeque<>();

        private record Draft(Asset asset, AssetVersion version, Map<String, LocaleRelease> statuses) {}

        private record Node(Asset asset, AssetVersion version, String key) {}

        Dependencies(long projectId, Resolution resolution) {
            this.projectId = projectId;
            this.config = projectLocales.forProject(projectId);
            for (Resolved item : resolution.items()) {
                selected.add(id(item.asset().getId(), item.key()));
                drafts.put(item.asset().getId(), Optional.of(new Draft(item.asset(), item.draft(),
                        resolution.statuses().getOrDefault(item.asset().getId(), Map.of()))));
            }
            for (Resolved item : resolution.items()) {
                if (!item.draft().isDeleted()) {
                    queue.add(new Node(item.asset(), item.draft(), item.key()));
                }
            }
        }

        /**
         * Walks the queue one breadth-first layer at a time — the same order as node by node — so each layer's
         * outgoing edges and the drafts they (and the nodes' folders) lead to are read in bulk.
         */
        List<ReleasePlan.Dependency> propose() {
            Set<String> descendantsOffered = new HashSet<>();
            while (!queue.isEmpty()) {
                List<Node> layer = new ArrayList<>(queue);
                queue.clear();
                Map<Long, List<AssetReference>> edges = new HashMap<>();
                Set<Long> from = layer.stream().map(node -> node.asset().getId()).collect(Collectors.toSet());
                Chunks.flatMap(from, referenceRepository::findByFromAssetIdInAndValidToRevisionIsNull)
                        .forEach(edge -> edges.computeIfAbsent(edge.getFromAssetId(), id -> new ArrayList<>()).add(edge));
                Set<Long> needed = new HashSet<>();
                edges.values().forEach(list -> list.forEach(edge -> needed.add(edge.getToAssetId())));
                layer.stream().map(node -> node.version().getFolderId()).filter(Objects::nonNull).forEach(needed::add);
                prefetch(needed);
                for (Node node : layer) {
                    for (AssetReference edge : edges.getOrDefault(node.asset().getId(), List.of())) {
                        consider(edge.getToAssetId(), node, ReleasePlan.Reason.REFERENCE, TO_PROPOSE, true);
                    }
                    if (node.version().getFolderId() != null) {
                        considerContainers(node);
                    }
                    if (node.asset().getAssetType() == AssetType.RECORD_SET) {
                        List<AssetVersion> members =
                                versionRepository.findByFolderIdAndValidToRevisionIsNullAndDeletedFalse(node.asset().getId());
                        prefetch(members.stream().map(AssetVersion::getAssetId).toList());
                        for (AssetVersion member : members) {
                            consider(member.getAssetId(), node, ReleasePlan.Reason.SET_MEMBER, TO_PROPOSE, true);
                        }
                    }
                    if (node.asset().getAssetType() == AssetType.FOLDER
                            && selected.contains(id(node.asset().getId(), node.key()))
                            && statusOf(node.asset().getId(), node.key()) == ReleaseStatus.CHANGED
                            && descendantsOffered.add(id(node.asset().getId(), node.key()))) {
                        offerDescendants(node);
                    }
                }
            }
            return List.copyOf(proposed.values());
        }

        /** Loads the drafts and statuses of the {@code assetIds} not known yet, in a fixed number of queries. */
        private void prefetch(java.util.Collection<Long> assetIds) {
            Set<Long> missing = assetIds.stream().filter(id -> !drafts.containsKey(id)).collect(Collectors.toSet());
            if (missing.isEmpty()) {
                return;
            }
            List<AssetVersion> releasable = Chunks.flatMap(missing, versionRepository::findOpenWithAssetByAssetIdIn).stream()
                    .filter(v -> v.getAsset().getProjectId().equals(projectId))
                    .filter(v -> ReleasableTypes.isReleasable(v.getAsset().getAssetType(), v.getPayload(), v.getAsset().getUid()))
                    .toList();
            Map<Long, Map<String, LocaleRelease>> statuses = statusService.ofVersions(projectId, releasable);
            for (AssetVersion version : releasable) {
                drafts.put(version.getAssetId(), Optional.of(
                        new Draft(version.getAsset(), version, statuses.getOrDefault(version.getAssetId(), Map.of()))));
            }
            missing.forEach(id -> drafts.putIfAbsent(id, Optional.empty()));
        }

        private void considerContainers(Node node) {
            Long parentId = node.version().getFolderId();
            Set<Long> seen = new HashSet<>();
            while (parentId != null && seen.add(parentId)) {
                Optional<Draft> parent = draft(parentId);
                if (parent.isEmpty()) {
                    return;
                }
                consider(parentId, node, ReleasePlan.Reason.CONTAINER, Set.of(ReleaseStatus.NEW, ReleaseStatus.UNPUBLISHED), true);
                parentId = parent.get().version().getFolderId();
            }
        }

        private void offerDescendants(Node folder) {
            Deque<Long> folders = new ArrayDeque<>(List.of(folder.asset().getId()));
            Set<Long> seen = new HashSet<>();
            while (!folders.isEmpty()) {
                Long current = folders.poll();
                if (!seen.add(current)) {
                    continue;
                }
                List<AssetVersion> children = versionRepository.findByFolderIdAndValidToRevisionIsNullAndDeletedFalse(current);
                prefetch(children.stream().map(AssetVersion::getAssetId).toList());
                for (AssetVersion child : children) {
                    consider(child.getAssetId(), folder, ReleasePlan.Reason.DESCENDANT, Set.of(ReleaseStatus.CHANGED), false);
                    folders.add(child.getAssetId());
                }
            }
        }

        private void consider(Long assetId, Node via, ReleasePlan.Reason reason, Set<ReleaseStatus> wanted, boolean byDefault) {
            Optional<Draft> target = draft(assetId);
            if (target.isEmpty() || target.get().version().isDeleted()) {
                return;
            }
            String key = keyFor(target.get(), via.key());
            if (key == null) {
                return;
            }
            String id = id(assetId, key);
            if (selected.contains(id) || proposed.containsKey(id)) {
                return;
            }
            LocaleRelease status = target.get().statuses().get(key);
            if (status == null || !wanted.contains(status.status())) {
                return;
            }
            Asset asset = target.get().asset();
            AssetVersion version = target.get().version();
            proposed.put(id, new ReleasePlan.Dependency(
                    new ReleaseTarget(asset.getUuid(), asset.getAssetType(), asset.getUid(), version.getDisplayName(), key,
                            status.status(), version.getId()),
                    reason,
                    via.asset().getUuid(),
                    byDefault));
            if (byDefault) {
                queue.add(new Node(asset, version, key));
            }
        }

        /** The dependency's key for a need in {@code locale}: the same locale, or its shared key. */
        private String keyFor(Draft target, String locale) {
            List<String> keys = ReleaseLocales.keysFor(config, target.asset().getAssetType(), target.version().getPayload());
            if (keys.contains(locale)) {
                return locale;
            }
            if (keys.equals(List.of(ReleaseLocales.ALL))) {
                return ReleaseLocales.ALL;
            }
            // A shared-key selection (non-localized media) needs nothing per locale.
            return null;
        }

        private ReleaseStatus statusOf(Long assetId, String key) {
            return draft(assetId).map(d -> d.statuses().get(key)).map(LocaleRelease::status).orElse(null);
        }

        private Optional<Draft> draft(Long assetId) {
            return drafts.computeIfAbsent(assetId, id -> {
                Optional<Asset> asset = assetRepository.findById(id);
                if (asset.isEmpty() || !asset.get().getProjectId().equals(projectId)) {
                    return Optional.empty();
                }
                Optional<AssetVersion> version = versionRepository.findByAssetIdAndValidToRevisionIsNull(id);
                if (version.isEmpty()
                        || !ReleasableTypes.isReleasable(asset.get().getAssetType(), version.get().getPayload(), asset.get().getUid())) {
                    return Optional.empty();
                }
                Map<String, LocaleRelease> statuses = statusService
                        .of(projectId, List.of(new ReleaseStatusService.Draft(asset.get(), version.get())))
                        .getOrDefault(id, Map.of());
                return Optional.of(new Draft(asset.get(), version.get(), statuses));
            });
        }

        private static String id(Long assetId, String key) {
            return assetId + "|" + key;
        }
    }
}
