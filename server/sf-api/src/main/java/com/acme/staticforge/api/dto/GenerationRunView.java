package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Client-facing generation run summary (spec §18.5, §20.2). {@code planSummary} (M22.1.2) is the plan the run built, or
 * {@code null} for a run that didn't get past PLAN. {@code comment} is the note it was started with — a user's, or a
 * schedule's ("Scheduled generation #12: …", "After scheduled release #7") — {@code null} for none. {@code startedBy}
 * (M28.2.2) is who started it — the schedule's owner for a scheduled run, {@code Deleted user} once that account was
 * deleted — or {@code null} when unknown (a system start). {@code findingCounts} (M30.1.2) are the run's quality check
 * findings in numbers, {@code null} for a run that stored none (before M30, or not finished). {@code diagnostics} is
 * {@code {errors, warnings}}, each {@code [{code, count, messages}]}, plus {@code heldBack}
 * ({@code [{asset, uid, channel, locale, codes}]}, M30.6.2) when the quality checks held pages back — the
 * {@code SF-GEN-0125} errors as data. An entry of {@code errors} about pages ({@code SF-GEN-0111}, M35) also has
 * {@code pages} ({@code [{uuid, uid, displayName, path}]}, at most 50); absent for other codes and older runs.
 *
 * <p>M35.24: {@code trigger} is what started the run ({@code MANUAL}, {@code SCHEDULE}, {@code RELEASE}; runs before
 * then are {@code MANUAL}). {@code planState} says what the plan endpoint has: {@code STORED} (entries available),
 * {@code PRUNED} (summary only, retention removed the entries), {@code PENDING} (not planned yet: the run is queued or
 * just started) or {@code NONE} (the run ended before it planned). {@code heldBack} is {@code diagnostics.heldBack} as
 * typed data: the pages the quality checks held back, empty for none; {@code name} is the page's current display name
 * (its uid when the page has no name any more, {@code null} for a deleted page of an old run).
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
        FindingCountsView findingCounts,
        String trigger,
        String planState,
        List<HeldBackPage> heldBack) {

    /** A page held back by the quality checks, in one channel and language. */
    public record HeldBackPage(UUID assetUuid, String name, String locale, String channel) {}

    /** The user who started a run. */
    public record StartedBy(long id, String displayName) {}
}
