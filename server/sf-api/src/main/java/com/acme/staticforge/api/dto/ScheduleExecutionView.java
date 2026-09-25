package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/**
 * One execution of a schedule (M27.4.4). Open ({@code finishedAt} {@code null}) while it waits for a busy project;
 * {@code outcome} is then what it ends with if cancelled. A generation execution succeeds when its run is
 * <em>started</em> — {@code generationRunId} links the run, whose own status is in the run history. {@code detail}
 * carries per-item results of a release ({@code items[{assetUuid, locale, result, reason}]}) and, for a failure, its
 * {@code code} ({@code SF-DOM-0160} unknown type, {@code 0162} target gone, {@code 0163} owner no longer permitted).
 */
public record ScheduleExecutionView(
        long id,
        Instant scheduledFor,
        Instant startedAt,
        Instant finishedAt,
        String outcome,
        long lateByMs,
        String message,
        JsonNode detail,
        Long revisionId,
        Long generationRunId,
        Long executedAsUserId) {}
