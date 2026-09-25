package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/**
 * Create or edit a schedule (M27.4.4). One-off types take {@code runAt} (an ISO instant), recurring types {@code cron}
 * (five or six fields) with {@code zoneId} (IANA, the creator's zone — the cron is evaluated there). {@code maxLateness}
 * is an ISO-8601 duration ({@code PT15M}), required with {@code missedPolicy = SKIP_IF_LATER_THAN}. {@code params} are
 * the type's: {@code RELEASE} {@code {items:[{assetUuid, locale?}], includeDependencies?:[…], comment?}},
 * {@code UNPUBLISH} {@code {items, comment?}}, {@code GENERATION}/{@code RECURRING_GENERATION}
 * {@code {mode, channels?, targetId?, scope?:{folderPath?, assetUuids?}, comment?}}. {@code pinPolicy}
 * ({@code PINNED} default | {@code LATEST}) and {@code thenGenerate} ({@code {targetId?, channels?}}) apply to
 * {@code RELEASE}/{@code UNPUBLISH}. On an edit, {@code params} omitted keeps the stored ones (and a release's pins).
 */
public record ScheduleRequest(
        String type,
        Instant runAt,
        String cron,
        String zoneId,
        String pinPolicy,
        String missedPolicy,
        String maxLateness,
        JsonNode thenGenerate,
        JsonNode params) {}
