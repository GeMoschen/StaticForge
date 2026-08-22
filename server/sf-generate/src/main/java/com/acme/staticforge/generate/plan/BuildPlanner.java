package com.acme.staticforge.generate.plan;

import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
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
 * a {@code lastSuccessfulRevision}) expands the set of assets changed since that revision
 * transitively over {@code asset_reference} reverse edges plus page→template/section edges, and
 * only renders the affected pages.
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
        if (incremental) {
            changedAssets = changedAssets(snapshot, lastSuccessfulRevision);
            pageUuids = affectedPages(snapshot, changedAssets);
        } else {
            pageUuids = new LinkedHashSet<>(snapshot.pages().stream().map(SnapshotAsset::uuid).toList());
        }

        List<PlanEntry> entries = new ArrayList<>();
        for (UUID pageUuid : sorted(pageUuids)) {
            SnapshotAsset page = snapshot.assetByUuid(pageUuid);
            if (page == null) {
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

        return new BuildPlan(incremental, snapshot.revision(), entries, changedAssets);
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

    /**
     * Expands changed assets transitively to the set of affected pages. Reverse edges come from
     * {@code asset_reference}; page→page-template and page→section-template edges come from the
     * page payload, since both are structural (not materialized as reference rows).
     */
    private Set<UUID> affectedPages(Snapshot snapshot, Set<UUID> changedAssets) {
        Map<UUID, List<UUID>> pagesByTemplate = new HashMap<>();
        Map<UUID, List<UUID>> pagesBySection = new HashMap<>();
        indexPages(snapshot, pagesByTemplate, pagesBySection);

        Map<UUID, Long> uuidToId = new HashMap<>();
        snapshot.byUuid().values().forEach(a -> uuidToId.put(a.uuid(), a.assetId()));

        Deque<Long> frontier = new ArrayDeque<>();
        for (UUID changed : changedAssets) {
            Long id = uuidToId.get(changed);
            if (id != null) {
                frontier.add(id);
            }
        }

        Set<UUID> affected = new LinkedHashSet<>();
        Set<Long> visited = new HashSet<>();
        while (!frontier.isEmpty()) {
            long id = frontier.poll();
            if (!visited.add(id)) {
                continue;
            }
            SnapshotAsset asset = snapshot.assetById(id);
            if (asset != null) {
                switch (asset.type()) {
                    case PAGE -> affected.add(asset.uuid());
                    case PAGE_TEMPLATE -> affected.addAll(pagesByTemplate.getOrDefault(asset.uuid(), List.of()));
                    case SECTION_TEMPLATE -> affected.addAll(pagesBySection.getOrDefault(asset.uuid(), List.of()));
                    default -> { /* template/media/structure/folder: propagate via references */ }
                }
            }
            for (AssetReference ref : references.findByToAssetId(id)) {
                long fromId = ref.getFromAssetId();
                if (fromId != id && !visited.contains(fromId)) {
                    frontier.add(fromId);
                }
            }
        }
        return affected;
    }

    /** Indexes page → template and page → section-template edges for the incremental expansion. */
    private static void indexPages(
            Snapshot snapshot, Map<UUID, List<UUID>> pagesByTemplate, Map<UUID, List<UUID>> pagesBySection) {
        for (SnapshotAsset page : snapshot.pages()) {
            JsonNode payload = page.payload();
            if (payload == null) {
                continue;
            }
            UUID pageTemplate = parseUuid(payload.path("templateRef").asText());
            if (pageTemplate != null) {
                pagesByTemplate.computeIfAbsent(pageTemplate, k -> new ArrayList<>()).add(page.uuid());
            }
            JsonNode bodies = payload.get("bodies");
            if (bodies != null && bodies.isObject()) {
                bodies.fields().forEachRemaining(entry -> {
                    JsonNode sections = entry.getValue();
                    if (sections.isArray()) {
                        for (JsonNode section : sections) {
                            UUID sectionUuid = parseUuid(section.path("templateRef").asText());
                            if (sectionUuid != null) {
                                pagesBySection.computeIfAbsent(sectionUuid, k -> new ArrayList<>()).add(page.uuid());
                            }
                        }
                    }
                });
            }
        }
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

    private static UUID parseUuid(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static <T> List<T> sorted(Set<T> values) {
        return values.stream().sorted(Comparator.comparing(v -> v.toString())).toList();
    }
}
