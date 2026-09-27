package com.acme.staticforge.revision.compaction;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.format.DateTimeParseException;

/**
 * A project's revision compaction policy (M29.4.1, spec §7.7, epic decision 13), stored in
 * {@code project.compaction_policy}. Compaction is opt-in: a project without a policy, or with {@code enabled = false},
 * is never compacted.
 *
 * @param enabled whether the weekly {@code revision-compaction} job compacts the project
 * @param olderThanDays only versions whose revision is older than this many days are compacted; at least
 *     {@value #MIN_OLDER_THAN_DAYS}
 * @param enabledAt when compaction was last switched on; {@code null} while off
 * @param enabledBy who switched it on; {@code null} while off
 */
public record CompactionPolicy(boolean enabled, int olderThanDays, Instant enabledAt, Long enabledBy) {

    /** The smallest {@code olderThanDays} (epic decision 13, {@code SF-DOM-0183} below it). */
    public static final int MIN_OLDER_THAN_DAYS = 30;

    /** {@code olderThanDays} of a project that never configured compaction. */
    public static final int DEFAULT_OLDER_THAN_DAYS = 90;

    /** The policy of a project that never configured compaction. */
    public static final CompactionPolicy OFF = new CompactionPolicy(false, DEFAULT_OLDER_THAN_DAYS, null, null);

    /** The policy stored in {@code json}; {@link #OFF} for {@code null} or a value that isn't a policy. */
    public static CompactionPolicy fromJson(JsonNode json) {
        if (json == null || !json.isObject()) {
            return OFF;
        }
        JsonNode days = json.get("olderThanDays");
        return new CompactionPolicy(
                json.path("enabled").asBoolean(false),
                days != null && days.canConvertToInt() ? days.asInt() : DEFAULT_OLDER_THAN_DAYS,
                instant(json.get("enabledAt")),
                json.path("enabledBy").canConvertToLong() && !json.path("enabledBy").isNull()
                        ? json.get("enabledBy").asLong()
                        : null);
    }

    public ObjectNode toJson() {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.put("enabled", enabled);
        node.put("olderThanDays", olderThanDays);
        if (enabledAt == null) {
            node.putNull("enabledAt");
        } else {
            node.put("enabledAt", enabledAt.toString());
        }
        if (enabledBy == null) {
            node.putNull("enabledBy");
        } else {
            node.put("enabledBy", enabledBy);
        }
        return node;
    }

    private static Instant instant(JsonNode value) {
        if (value == null || !value.isTextual()) {
            return null;
        }
        try {
            return Instant.parse(value.asText());
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
