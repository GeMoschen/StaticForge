package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/**
 * One run of a system job (M29.1.2). {@code outcome}, {@code finishedAt} and {@code durationMs} are {@code null}
 * while it runs ({@code message} is then its progress line). {@code sample} holds at most 50 items of what the run
 * handled (what it would remove, for a dry run) and {@code sampleTotal} counts them all. {@code report} — the job's
 * structured report with the sample and, for a failure, an {@code error} digest — is only in the single-run response.
 * {@code startedBy} is {@code null} for scheduled and startup runs.
 */
public record AdminJobRunView(
        long id,
        String jobKey,
        String trigger,
        boolean dryRun,
        Instant startedAt,
        Instant finishedAt,
        Long durationMs,
        String outcome,
        long itemsExamined,
        long itemsAffected,
        long bytesFreed,
        String message,
        AdminAuditEntry.Actor startedBy,
        JsonNode sample,
        long sampleTotal,
        JsonNode report) {}
