package com.acme.staticforge.housekeeping;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** {@link SettingsSpec} and {@link JobSettings}: the validation and typed reads every job reuses (M29.1.1). */
class SettingsSpecTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final SettingsSpec SPEC = SettingsSpec.builder()
            .integer("keepDays", 1, 3650)
            .duration("grace", Duration.ofHours(1), Duration.ofDays(30))
            .bool("verbose")
            .oneOf("mode", Set.of("fast"))
            .build();

    private static ObjectNode valid() {
        return JSON.createObjectNode().put("keepDays", 90).put("grace", "PT24H").put("verbose", false).put("mode", "fast");
    }

    @Test
    @DisplayName("valid settings have no problems; durations may be ISO-8601 or short")
    void validSettings() {
        assertThat(SPEC.validate(valid())).isEmpty();
        assertThat(SPEC.validate(valid().put("grace", "2d"))).isEmpty();
        assertThat(JobSettings.of(valid().put("grace", "2d")).duration("grace")).isEqualTo(Duration.ofDays(2));
        assertThat(JobSettings.of(valid()).intValue("keepDays")).isEqualTo(90);
        assertThat(JobSettings.of(valid()).bool("verbose")).isFalse();
        assertThat(JobSettings.of(valid()).text("mode")).isEqualTo("fast");
    }

    @Test
    @DisplayName("every problem is reported once: unknown, missing, wrong type, out of bounds")
    void everyProblemReported() {
        ObjectNode settings = valid().put("keepDays", 0).put("grace", "30m").put("colour", "red");
        settings.remove("verbose");
        settings.put("mode", 3);
        assertThat(SPEC.validate(settings)).containsExactly(
                "Unknown setting 'colour'.",
                "Setting 'keepDays' must be a whole number from 1 to 3650.",
                "Setting 'grace' must be at least PT1H.",
                "Setting 'verbose' is required.",
                "Setting 'mode' must be one of fast.");
        assertThat(SPEC.validate(valid().put("grace", "P60D"))).containsExactly("Setting 'grace' must be at most PT720H.");
        assertThat(SPEC.validate(valid().put("grace", "soon"))).containsExactly(
                "Setting 'grace' must be a duration such as PT30M or 30m.");
        assertThat(SPEC.validate(JSON.createArrayNode())).containsExactly("Settings must be a JSON object.");
    }
}
