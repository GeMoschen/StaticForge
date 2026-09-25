package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

/**
 * A schedule (M27.4.4). {@code runAt} is set for one-off types, {@code cron} + {@code zoneId} for recurring ones;
 * {@code nextRunAt} is when it is next due ({@code null} once finished, cancelled or paused). {@code version} is the
 * value for {@code If-Match} on an edit (also sent as {@code ETag: "v{version}"}). {@code driftCount} (pinned
 * releases) counts items whose draft changed since they were scheduled. {@code items} is filled on the detail only.
 */
public record ScheduleView(
        long id,
        String type,
        String status,
        Instant runAt,
        String cron,
        String zoneId,
        Instant nextRunAt,
        String pinPolicy,
        String missedPolicy,
        String maxLateness,
        JsonNode thenGenerate,
        JsonNode params,
        Long ownerUserId,
        Long createdBy,
        Instant createdAt,
        Instant updatedAt,
        long version,
        int itemCount,
        Integer driftCount,
        List<ScheduleItemView> items,
        ScheduleExecutionView lastExecution) {}
