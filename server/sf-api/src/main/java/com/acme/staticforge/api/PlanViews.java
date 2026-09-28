package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.GenerationPlanView;
import com.acme.staticforge.api.dto.PlanEntryView;
import com.acme.staticforge.api.dto.PlanSummaryView;
import com.acme.staticforge.api.dto.RecordPageView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.PlanInsight;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.insight.RebuildReason;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.generate.insight.RunPlanStore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

/** Maps plans and their reasons to the build insight views (M22.2). */
final class PlanViews {

    static final int MAX_PAGE_SIZE = 500;

    private PlanViews() {}

    static Pageable pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new SfException(ProblemFactory.badRequest("page must be >= 0 and size between 1 and " + MAX_PAGE_SIZE + "."));
        }
        return PageRequest.of(page, size);
    }

    static PlanEntryRecord.Filter filter(String rootKind, String channel, String q) {
        RebuildRootKind kind = rootKind == null || rootKind.isBlank() ? null : RebuildRootKind.parse(rootKind.trim());
        return new PlanEntryRecord.Filter(kind, blankToNull(channel), null, q);
    }

    /** One page of {@code entries} passing {@code filter}, for a plan held in memory. */
    static Page<PlanEntryRecord> page(List<PlanEntryRecord> entries, PlanEntryRecord.Filter filter, Pageable pageable) {
        List<PlanEntryRecord> matching = entries.stream().filter(filter::matches).toList();
        int from = (int) Math.min(pageable.getOffset(), matching.size());
        int to = Math.min(from + pageable.getPageSize(), matching.size());
        return new PageImpl<>(matching.subList(from, to), pageable, matching.size());
    }

    static GenerationPlanView.EntryPage entries(Page<PlanEntryRecord> page) {
        return new GenerationPlanView.EntryPage(
                page.getContent().stream().map(PlanViews::entry).toList(),
                new RecordPageView.PageMeta(page.getSize(), page.getNumber(), page.getTotalElements(), page.getTotalPages()));
    }

    static PlanEntryView entry(PlanEntryRecord entry) {
        RebuildReason reason = entry.reason();
        return new PlanEntryView(
                entry.assetUuid(),
                entry.assetType(),
                entry.uid(),
                entry.displayName(),
                entry.channel(),
                entry.outputPath(),
                entry.pageNumber(),
                new PlanEntryView.ReasonView(
                        reason.rootKind().name(),
                        reason.rootUuid() == null
                                ? null
                                : new PlanEntryView.AssetRef(reason.rootUuid(), reason.rootType(), reason.rootUid()),
                        reason.rootRevision(),
                        reason.causeCount(),
                        reason.fallbackCause() == null ? null : reason.fallbackCause().name(),
                        reason.steps().stream()
                                .map(step -> new PlanEntryView.StepView(step.assetUuid(), step.assetType(), step.uid(),
                                        step.edge().name(), step.referenceKind(), step.sourcePath()))
                                .toList()),
                entry.locale());
    }

    /** The typed view of a plan summary as {@code PlanInsight.summary} writes it; {@code null} for {@code null}. */
    static PlanSummaryView summary(JsonNode summary) {
        if (summary == null || summary.isNull()) {
            return null;
        }
        List<String> channels = new ArrayList<>();
        summary.path("coverage").path("channels").forEach(channel -> channels.add(channel.asText()));
        List<PlanSummaryView.Via> via = new ArrayList<>();
        summary.path("via").forEach(group -> via.add(new PlanSummaryView.Via(
                group.path("edge").asText(), group.path("assetUuid").asText(), group.path("assetType").asText(),
                group.path("uid").asText(null), group.path("count").asInt())));
        return new PlanSummaryView(
                summary.path("mode").asText(null),
                summary.path("incremental").asBoolean(),
                summary.path("revision").asLong(),
                summary.path("fallbackCause").asText(null),
                summary.hasNonNull("baselineRevision") ? summary.get("baselineRevision").asLong() : null,
                summary.hasNonNull("baseRunId") ? summary.get("baseRunId").asLong() : null,
                summary.path("coverage").path("scoped").asBoolean(),
                channels,
                summary.path("changedAssetCount").asInt(),
                summary.path("entryCount").asInt(),
                summary.path("pageCount").asInt(),
                summary.path("processedMediaCount").asInt(),
                counts(summary.path("byRootKind")),
                counts(summary.path("byFirstEdge")),
                counts(summary.path("byChannel")),
                via,
                RunPlanStore.available(summary),
                summary.hasNonNull(PlanInsight.REDIRECTS_ADDED) ? summary.get(PlanInsight.REDIRECTS_ADDED).asInt() : null,
                summary.hasNonNull(PlanInsight.REDIRECTS_ACTIVE) ? summary.get(PlanInsight.REDIRECTS_ACTIVE).asInt() : null);
    }

    /** The automatic redirects a dry run would add (M30.4.2). */
    static List<GenerationPlanView.RedirectCandidate> redirectCandidates(GenerationService.DryRun dryRun) {
        return dryRun.redirectCandidates().stream()
                .map(planned -> new GenerationPlanView.RedirectCandidate(
                        planned.candidate().channel(),
                        planned.candidate().locale(),
                        planned.candidate().fromPath(),
                        planned.candidate().toAssetUuid(),
                        planned.candidate().toPageNumber(),
                        planned.toPath()))
                .toList();
    }

    static List<GenerationPlanView.ChangedAsset> changedAssets(JsonNode summary) {
        List<GenerationPlanView.ChangedAsset> assets = new ArrayList<>();
        summary.path("changedAssets").forEach(asset -> assets.add(new GenerationPlanView.ChangedAsset(
                UUID.fromString(asset.path("uuid").asText()),
                asset.path("type").asText(),
                asset.path("uid").asText(null),
                asset.path("deleted").asBoolean(),
                asset.hasNonNull("revision") ? asset.get("revision").asLong() : null)));
        return assets;
    }

    private static Map<String, Integer> counts(JsonNode node) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        node.fields().forEachRemaining(field -> counts.put(field.getKey(), field.getValue().asInt()));
        return counts;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
