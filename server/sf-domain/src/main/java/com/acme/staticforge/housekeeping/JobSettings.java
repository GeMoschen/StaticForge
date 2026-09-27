package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;

/**
 * Typed reads of a job's persisted settings (M29.1.1), as a run sees them in {@link JobContext#settings()}. The runner
 * only hands out settings that passed {@link HousekeepingJob#validateSettings}, so a read of a key the job's
 * {@link SettingsSpec} declares succeeds; anything else is a programming error ({@link IllegalStateException}).
 */
public final class JobSettings {

    private final ObjectNode json;

    private JobSettings(ObjectNode json) {
        this.json = json;
    }

    /** A view of {@code settings}; {@code null} or a non-object is an empty set. */
    public static JobSettings of(JsonNode settings) {
        return new JobSettings(settings instanceof ObjectNode object
                ? object.deepCopy()
                : JsonNodeFactory.instance.objectNode());
    }

    /** A copy of the raw settings. */
    public ObjectNode json() {
        return json.deepCopy();
    }

    public boolean has(String key) {
        return json.hasNonNull(key);
    }

    /** An ISO-8601 ({@code PT5M}) or short ({@code 5m}) duration. */
    public Duration duration(String key) {
        Duration value = SettingsSpec.parseDuration(json.get(key));
        if (value == null) {
            throw notA(key, "a duration");
        }
        return value;
    }

    public long longValue(String key) {
        JsonNode value = json.get(key);
        if (value == null || !value.isIntegralNumber()) {
            throw notA(key, "a whole number");
        }
        return value.asLong();
    }

    public int intValue(String key) {
        return Math.toIntExact(longValue(key));
    }

    public boolean bool(String key) {
        JsonNode value = json.get(key);
        if (value == null || !value.isBoolean()) {
            throw notA(key, "true or false");
        }
        return value.asBoolean();
    }

    public String text(String key) {
        JsonNode value = json.get(key);
        if (value == null || !value.isTextual()) {
            throw notA(key, "a string");
        }
        return value.asText();
    }

    private static IllegalStateException notA(String key, String what) {
        return new IllegalStateException("Job setting '" + key + "' is not " + what);
    }
}
