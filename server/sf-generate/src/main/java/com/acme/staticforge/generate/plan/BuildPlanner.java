package com.acme.staticforge.generate.plan;

import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.ReferenceEdge;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Build planner (spec §18.3): turns a snapshot into an ordered {@link BuildPlan}. A FULL build
 * covers every page × each enabled channel; an INCREMENTAL build (mode {@code INCREMENTAL} with
 * a {@code lastSuccessfulRevision}) expands the set of assets changed since that revision over the
 * revision-valid reverse edges of {@code asset_reference}, and only renders the affected pages.
 */
@Service
public class BuildPlanner {

    private static final Set<String> DEFAULT_CHANNELS = Set.of("html");

    private final AssetVersionRepository versions;
    private final AssetReferenceRepository references;

    public BuildPlanner(AssetVersionRepository versions, AssetReferenceRepository references) {
        this.versions = versions;
        this.references = references;
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

        Set<UUID> changedAssets = Set.of();
        Set<UUID> pageUuids;
        Set<UUID> processedMedia = Set.of();
        if (incremental) {
            changedAssets = changedAssets(snapshot, lastSuccessfulRevision);
            Affected affected = affected(snapshot, changedAssets);
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
            for (String channel : sorted(effectiveChannels)) {
                entries.add(new PlanEntry(pageUuid, channel, paths.resolvePagePath(pageUuid, channel)));
            }
        }
        entries.sort(Comparator.comparing(PlanEntry::outputPath).thenComparing(PlanEntry::pageUuid));

        return new BuildPlan(incremental, snapshot.revision(), entries, changedAssets, processedMedia);
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
     * <p>Render-time-only dependencies are not covered by persisted rows. A template's
     * {@code $CMS_NAVIGATION(nav:…)$} or {@code $CMS_FOR(x : nav:…)$} renders the folder's whole
     * subtree, but only the folder itself is an edge target, so a changed page reference deep in that
     * subtree does not reach the template. Expanding that is {@code M22.1.1}'s job (§18.2 navigation
     * rule); do not bring back generation-time reference inserts to cover it.
     */
    private Affected affected(Snapshot snapshot, Set<UUID> changedAssets) {
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
            for (long fromId : referrers.getOrDefault(id, Set.of())) {
                if (!visited.contains(fromId)) {
                    frontier.add(fromId);
                }
            }
        }
        return new Affected(affected, processedMedia);
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
