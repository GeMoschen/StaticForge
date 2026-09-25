package com.acme.staticforge.scheduler;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.zone.ZoneOffsetTransition;
import java.time.zone.ZoneRules;
import java.util.ArrayList;
import java.util.List;
import org.springframework.scheduling.support.CronExpression;

/**
 * When a recurring action is due (M27.4.1, epic decision 24). A cron is evaluated in local time of the action's zone
 * and each matching local time is mapped to one instant:
 *
 * <ul>
 *   <li>a local time that doesn't exist (the clock springs forward over it) runs at the first valid instant after the
 *       gap — {@code 02:30} on the spring-forward day in {@code Europe/Berlin} runs at {@code 03:00} local;
 *   <li>a local time that exists twice (the clock falls back) runs once, at its first occurrence.
 * </ul>
 *
 * <p>Six-field cron expressions (seconds first) are used as they are, five-field ones get {@code 0} seconds; Spring's
 * macros ({@code @daily}, …) are accepted.
 */
public final class ScheduleTiming {

    /** Bounds the search for the next slot (a cron like {@code 0 0 0 30 2 *} never matches). */
    private static final int MAX_STEPS = 1000;

    private ScheduleTiming() {}

    /** {@code cron} in its six-field form; {@code 422 SF-DOM-0165} when it doesn't parse. */
    public static String normalizeCron(String cron) {
        if (cron == null || cron.isBlank()) {
            throw SchedulerProblems.invalidCron("A cron expression is required.", "cron");
        }
        String trimmed = cron.trim().replaceAll("\\s+", " ");
        String normalized = !trimmed.startsWith("@") && trimmed.split(" ").length == 5 ? "0 " + trimmed : trimmed;
        try {
            CronExpression.parse(normalized);
        } catch (IllegalArgumentException e) {
            throw SchedulerProblems.invalidCron("Invalid cron expression '" + cron + "': " + e.getMessage(), "cron");
        }
        return normalized;
    }

    /** The zone {@code zoneId} names; {@code 422 SF-DOM-0165} for a missing or unknown IANA id. */
    public static ZoneId zone(String zoneId) {
        if (zoneId == null || zoneId.isBlank()) {
            throw SchedulerProblems.invalidCron("A recurring schedule needs a time zone (zoneId).", "zoneId");
        }
        try {
            return ZoneId.of(zoneId.trim());
        } catch (DateTimeException e) {
            throw SchedulerProblems.invalidCron("Unknown time zone '" + zoneId + "'.", "zoneId");
        }
    }

    /** The first slot of {@code cron} in {@code zone} strictly after {@code after}; {@code null} if there is none. */
    public static Instant nextAfter(String cron, ZoneId zone, Instant after) {
        CronExpression expression = CronExpression.parse(normalizeCron(cron));
        ZoneRules rules = zone.getRules();
        LocalDateTime cursor = LocalDateTime.ofInstant(after, zone);
        for (int step = 0; step < MAX_STEPS; step++) {
            LocalDateTime local = expression.next(cursor);
            if (local == null) {
                return null;
            }
            Instant candidate = instantOf(local, rules);
            if (candidate.isAfter(after)) {
                return candidate;
            }
            cursor = local;
        }
        return null;
    }

    /** The next {@code count} slots strictly after {@code after} (fewer when the cron runs out). */
    public static List<Instant> next(String cron, ZoneId zone, Instant after, int count) {
        List<Instant> out = new ArrayList<>(count);
        Instant cursor = after;
        while (out.size() < count) {
            Instant next = nextAfter(cron, zone, cursor);
            if (next == null) {
                break;
            }
            out.add(next);
            cursor = next;
        }
        return out;
    }

    /** One instant per local time: the end of a gap for a skipped one, the first occurrence for a repeated one. */
    private static Instant instantOf(LocalDateTime local, ZoneRules rules) {
        List<ZoneOffset> offsets = rules.getValidOffsets(local);
        if (offsets.isEmpty()) {
            ZoneOffsetTransition gap = rules.getTransition(local);
            return gap.getInstant();
        }
        Instant first = null;
        for (ZoneOffset offset : offsets) {
            Instant instant = local.toInstant(offset);
            if (first == null || instant.isBefore(first)) {
                first = instant;
            }
        }
        return first;
    }
}
