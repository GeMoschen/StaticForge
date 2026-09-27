package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.boot.convert.DurationStyle;

/**
 * The shape of a job's settings, declared once (M29.1.1): which keys exist, their type and bounds. A job keeps one as
 * a constant and answers {@link HousekeepingJob#validateSettings} with {@link #validate}, which reports every problem
 * as one readable message — a missing key, an unknown key (settings never store unknown keys), a wrong type or a value
 * out of bounds:
 *
 * <pre>{@code
 * static final SettingsSpec SETTINGS = SettingsSpec.builder()
 *         .duration("retention", Duration.ofDays(30), null)
 *         .integer("batchSize", 1, 10_000)
 *         .build();
 *
 * public List<String> validateSettings(JsonNode settings) {
 *     return SETTINGS.validate(settings);
 * }
 * }</pre>
 *
 * Durations are strings, ISO-8601 ({@code "PT5M"}, {@code "P365D"}) or the short form of Spring properties
 * ({@code "5m"}, {@code "365d"}); {@link JobSettings#duration} reads both.
 */
public final class SettingsSpec {

    private final Map<String, Rule> rules;

    private SettingsSpec(Map<String, Rule> rules) {
        this.rules = Collections.unmodifiableMap(new LinkedHashMap<>(rules));
    }

    public static Builder builder() {
        return new Builder();
    }

    /** The declared keys, in declaration order. */
    public Set<String> keys() {
        return rules.keySet();
    }

    /** Every problem of {@code settings}, one message each; empty when they are valid. */
    public List<String> validate(JsonNode settings) {
        List<String> errors = new ArrayList<>();
        if (settings == null || !settings.isObject()) {
            errors.add("Settings must be a JSON object.");
            return errors;
        }
        for (Iterator<String> names = settings.fieldNames(); names.hasNext(); ) {
            String name = names.next();
            if (!rules.containsKey(name)) {
                errors.add("Unknown setting '" + name + "'.");
            }
        }
        rules.forEach((key, rule) -> {
            JsonNode value = settings.get(key);
            if (value == null || value.isNull()) {
                errors.add("Setting '" + key + "' is required.");
            } else {
                String problem = rule.check(key, value);
                if (problem != null) {
                    errors.add(problem);
                }
            }
        });
        return errors;
    }

    /** {@code value} as a duration, or {@code null} when it is not one (ISO-8601 or {@code 5m} style). */
    static Duration parseDuration(JsonNode value) {
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            return null;
        }
        try {
            return DurationStyle.detectAndParse(value.asText().trim());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    @FunctionalInterface
    private interface Rule {
        /** A message when {@code value} (not null) is invalid, else {@code null}. */
        String check(String key, JsonNode value);
    }

    /** Declares the keys of a {@link SettingsSpec}; each key once. */
    public static final class Builder {

        private final Map<String, Rule> rules = new LinkedHashMap<>();

        private Builder() {}

        /** A whole number from {@code min} to {@code max} (inclusive). */
        public Builder integer(String key, long min, long max) {
            return add(key, (k, v) -> v.isIntegralNumber() && v.canConvertToLong() && v.asLong() >= min && v.asLong() <= max
                    ? null
                    : "Setting '" + k + "' must be a whole number from " + min + " to " + max + ".");
        }

        /** A duration of at least {@code min} and, when {@code max} is not {@code null}, at most {@code max}. */
        public Builder duration(String key, Duration min, Duration max) {
            return add(key, (k, v) -> {
                Duration d = parseDuration(v);
                if (d == null) {
                    return "Setting '" + k + "' must be a duration such as PT30M or 30m.";
                }
                if (min != null && d.compareTo(min) < 0) {
                    return "Setting '" + k + "' must be at least " + min + ".";
                }
                if (max != null && d.compareTo(max) > 0) {
                    return "Setting '" + k + "' must be at most " + max + ".";
                }
                return null;
            });
        }

        /** {@code true} or {@code false}. */
        public Builder bool(String key) {
            return add(key, (k, v) -> v.isBoolean() ? null : "Setting '" + k + "' must be true or false.");
        }

        /** One of {@code values} (a string). */
        public Builder oneOf(String key, Set<String> values) {
            return add(key, (k, v) -> v.isTextual() && values.contains(v.asText())
                    ? null
                    : "Setting '" + k + "' must be one of " + String.join(", ", values) + ".");
        }

        public SettingsSpec build() {
            return new SettingsSpec(rules);
        }

        private Builder add(String key, Rule rule) {
            if (rules.putIfAbsent(key, rule) != null) {
                throw new IllegalArgumentException("Setting '" + key + "' is declared twice");
            }
            return this;
        }
    }
}
