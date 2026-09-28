package com.acme.staticforge.generate;

import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.insight.RebuildReason;
import com.acme.staticforge.generate.insight.RebuildStep;
import com.acme.staticforge.generate.insight.RunPlanStore;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.render.MediaOutputs;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

/**
 * A plan as it is explained (M22.1.2, M22.2.1): its entries with their reasons, and its summary. A run stores exactly
 * this; a dry run returns it without storing, so the two can't describe the same plan differently.
 */
public final class PlanInsight {

    /** How many changed assets a summary lists; {@code changedAssetCount} has the total. */
    static final int CHANGED_ASSETS_LISTED = 200;

    /** How many "via" groups a summary lists, largest first. */
    static final int VIA_LISTED = 20;

    private PlanInsight() {}

    /**
     * Every planned output with its reason, in plan order: page outputs, then processed media files an incremental
     * plan re-renders (by path) — a localized file once per locale it is written for (M27.3.2).
     */
    public static List<PlanEntryRecord> entries(PlannedBuild build) {
        Snapshot snapshot = build.snapshot();
        BuildPlan plan = build.plan();
        MediaOutputs outputs = new MediaOutputs(snapshot, build.paths().locales());
        List<PlanEntryRecord> entries = new ArrayList<>(plan.entries().size() + plan.processedMedia().size());
        for (PlanEntry entry : plan.entries()) {
            SnapshotAsset page = snapshot.asset(entry.pageUuid(), entry.locale());
            entries.add(new PlanEntryRecord(
                    page.uuid(),
                    page.type().name(),
                    page.uid(),
                    page.displayName(),
                    entry.channel(),
                    entry.outputPath(),
                    entry.pagination() == null ? null : entry.pageNumber(),
                    plan.reasonFor(page.uuid()),
                    entry.locale()));
        }
        List<PlanEntryRecord> media = new ArrayList<>();
        for (UUID uuid : plan.processedMedia()) {
            media.addAll(mediaEntries(outputs, uuid, plan.reasonFor(uuid)));
        }
        media.sort(Comparator.comparing(PlanEntryRecord::outputPath));
        entries.addAll(media);
        return entries;
    }

    /** One entry per output of processed media file {@code uuid}, each with the locale it is written for. */
    static List<PlanEntryRecord> mediaEntries(MediaOutputs outputs, UUID uuid, RebuildReason reason) {
        List<PlanEntryRecord> entries = new ArrayList<>();
        for (MediaOutputs.Output output : outputs.outputsOf(uuid)) {
            SnapshotAsset file = output.asset();
            entries.add(new PlanEntryRecord(
                    file.uuid(), file.type().name(), file.uid(), file.displayName(), null, output.path(), null, reason,
                    output.key().locale()));
        }
        return entries;
    }

    /**
     * The summary of a planned build: what was requested and decided (mode, baseline, fallback, coverage) and the entry
     * counts by root kind, first edge, channel and the largest "via" groups.
     */
    public static ObjectNode summary(
            ObjectMapper mapper, PlannedBuild build, GenerationRequest request, List<PlanEntryRecord> entries) {
        BuildPlan plan = build.plan();
        Snapshot snapshot = build.snapshot();
        ObjectNode summary = mapper.createObjectNode();
        summary.put("mode", (request.mode() == null ? GenerationMode.FULL : request.mode()).name());
        summary.put("incremental", plan.incremental());
        summary.put("revision", plan.revision());
        if (plan.fallbackCause() != null) {
            summary.put("fallbackCause", plan.fallbackCause().name());
        }
        if (plan.baselineRevision() != null) {
            summary.put("baselineRevision", plan.baselineRevision());
        }
        if (build.carries()) {
            summary.put("baseRunId", build.baseRunId());
        }
        ObjectNode coverage = summary.putObject("coverage");
        coverage.put("scoped", (request.folderPath() != null && !request.folderPath().isBlank())
                || (request.assetUuids() != null && !request.assetUuids().isEmpty()));
        ArrayNode channels = coverage.putArray("channels");
        build.channels().stream().sorted().forEach(channels::add);

        summary.put("changedAssetCount", plan.changedAssets().size());
        ArrayNode changed = summary.putArray("changedAssets");
        plan.changedAssets().stream()
                .map(snapshot::assetByUuid)
                .sorted(Comparator.comparing((SnapshotAsset asset) -> asset.type().name()).thenComparing(SnapshotAsset::uid))
                .limit(CHANGED_ASSETS_LISTED)
                .forEach(asset -> {
                    ObjectNode node = changed.addObject();
                    node.put("uuid", asset.uuid().toString());
                    node.put("type", asset.type().name());
                    node.put("uid", asset.uid());
                    node.put("deleted", asset.deleted());
                    Long revision = plan.changeRevisions().get(asset.uuid());
                    if (revision != null) {
                        node.put("revision", revision);
                    }
                });

        Map<String, Integer> byRootKind = new TreeMap<>();
        Map<String, Integer> byFirstEdge = new TreeMap<>();
        Map<String, Integer> byChannel = new TreeMap<>();
        Map<ViaKey, Integer> via = new LinkedHashMap<>();
        Set<UUID> pages = new HashSet<>();
        int media = 0;
        for (PlanEntryRecord entry : entries) {
            RebuildReason reason = entry.reason();
            byRootKind.merge(reason.rootKind().name(), 1, Integer::sum);
            byFirstEdge.merge(reason.firstEdge() == null ? "NONE" : reason.firstEdge().name(), 1, Integer::sum);
            if (entry.channel() == null) {
                media++;
            } else {
                byChannel.merge(entry.channel(), 1, Integer::sum);
                pages.add(entry.assetUuid());
            }
            viaKey(reason).ifPresent(key -> via.merge(key, 1, Integer::sum));
        }
        summary.put("entryCount", entries.size());
        summary.put("pageCount", pages.size());
        summary.put("processedMediaCount", media);
        summary.set("byRootKind", mapper.valueToTree(byRootKind));
        summary.set("byFirstEdge", mapper.valueToTree(byFirstEdge));
        summary.set("byChannel", mapper.valueToTree(byChannel));
        ArrayNode viaNode = summary.putArray("via");
        via.entrySet().stream()
                .sorted(Map.Entry.<ViaKey, Integer>comparingByValue().reversed()
                        .thenComparing(e -> e.getKey().uid() == null ? "" : e.getKey().uid()))
                .limit(VIA_LISTED)
                .forEach(e -> {
                    ObjectNode node = viaNode.addObject();
                    node.put("edge", e.getKey().edge());
                    node.put("assetUuid", e.getKey().assetUuid().toString());
                    node.put("assetType", e.getKey().assetType());
                    node.put("uid", e.getKey().uid());
                    node.put("count", e.getValue());
                });
        summary.put(RunPlanStore.PLAN_AVAILABLE, true);
        return summary;
    }

    /** Summary key: how many automatic redirects the build added or re-pointed (a dry run: would add). */
    public static final String REDIRECTS_ADDED = "redirectsAdded";

    /** Summary key: how many redirects the build emitted. */
    public static final String REDIRECTS_ACTIVE = "redirectsActive";

    /**
     * A copy of {@code summary} with the redirect counts of its build (M30.4.2); a {@code null} count is left out (a dry
     * run knows what it would add, not what a build would emit). {@code null} for a {@code null} summary.
     */
    public static ObjectNode redirects(JsonNode summary, Integer added, Integer active) {
        if (summary == null || !summary.isObject()) {
            return null;
        }
        ObjectNode copy = ((ObjectNode) summary).deepCopy();
        if (added != null) {
            copy.put(REDIRECTS_ADDED, added);
        }
        if (active != null) {
            copy.put(REDIRECTS_ACTIVE, active);
        }
        return copy;
    }

    /** The first edge of a chain and the asset it leads to: "412 pages via section_template:teaser". */
    private record ViaKey(String edge, UUID assetUuid, String assetType, String uid) {}

    private static java.util.Optional<ViaKey> viaKey(RebuildReason reason) {
        List<RebuildStep> steps = reason.steps();
        if (steps.isEmpty()) {
            return java.util.Optional.empty();
        }
        String edge = steps.get(0).edge().name();
        if (steps.size() > 1) {
            RebuildStep next = steps.get(1);
            return java.util.Optional.of(new ViaKey(edge, next.assetUuid(), next.assetType(), next.uid()));
        }
        return java.util.Optional.of(new ViaKey(edge, reason.rootUuid(), reason.rootType(), reason.rootUid()));
    }
}
