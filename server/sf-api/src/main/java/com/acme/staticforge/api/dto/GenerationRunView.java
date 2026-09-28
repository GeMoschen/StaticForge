package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

/**
 * Client-facing generation run summary (spec §18.5, §20.2). {@code planSummary} (M22.1.2) is the plan the run built, or
 * {@code null} for a run that didn't get past PLAN. {@code comment} is the note it was started with — a user's, or a
 * schedule's ("Scheduled generation #12: …", "After scheduled release #7") — {@code null} for none. {@code startedBy}
 * (M28.2.2) is who started it — the schedule's owner for a scheduled run, {@code Deleted user} once that account was
 * deleted — or {@code null} when unknown (a system start). {@code findingCounts} (M30.1.2) are the run's quality check
 * findings in numbers, {@code null} for a run that stored none (before M30, or not finished). {@code diagnostics} is
 * {@code {errors, warnings}}, each {@code [{code, count, messages}]}, plus {@code heldBack}
 * ({@code [{asset, uid, channel, locale, codes}]}, M30.6.2) when the quality checks held pages back — the
 * {@code SF-GEN-0125} errors as data.
 */
public record GenerationRunView(
        Long id,
        Long revisionId,
        String mode,
        List<String> channels,
        Long targetId,
        String status,
        Instant startedAt,
        Instant finishedAt,
        long filesWritten,
        long filesSkipped,
        long bytesWritten,
        int errorCount,
        int warningCount,
        JsonNode diagnostics,
        PlanSummaryView planSummary,
        String comment,
        StartedBy startedBy,
        FindingCountsView findingCounts) {

    /** The user who started a run. */
    public record StartedBy(long id, String displayName) {}
}
