package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;

/**
 * A generation plan with its reasons (M22.2.1): the dry run of a request ({@code runId} null) or a past run's stored
 * plan.
 *
 * @param changedAssets the changes since the baseline, at most 200 ({@code summary.changedAssetCount} is the total)
 * @param entries a page of planned outputs; {@code null} when a stored plan was pruned
 * @param diagnostics dry run with {@code validate=true} only: VALIDATE findings grouped by code, like a run's
 * @param redirectCandidates dry run only (M30.4.2): the automatic redirects the run would add — each planned page
 *     output whose path differs from the target's current build, sorted by channel, locale and source path;
 *     {@code null} for a stored plan (its summary has the counts)
 */
public record GenerationPlanView(
        Long runId,
        TargetRef target,
        PlanSummaryView summary,
        List<ChangedAsset> changedAssets,
        EntryPage entries,
        JsonNode diagnostics,
        List<RedirectCandidate> redirectCandidates) {

    public record TargetRef(Long id, String name) {}

    public record ChangedAsset(UUID uuid, String type, String uid, boolean deleted, Long revision) {}

    /**
     * An automatic redirect a dry run would add: {@code fromPath} (the current build's path) leads to page
     * {@code toPageNumber} of {@code toAssetUuid}, planned at {@code toPath}. {@code locale} is {@code ""} in a
     * project without locales.
     */
    public record RedirectCandidate(
            String channel, String locale, String fromPath, UUID toAssetUuid, int toPageNumber, String toPath) {}

    public record EntryPage(List<PlanEntryView> content, RecordPageView.PageMeta page) {}
}
