package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.springframework.stereotype.Component;

/** A test job bean that always throws (M29.1.1; test sources only); disabled by default, no dry run, no settings. */
@Component
public class FailingJob implements HousekeepingJob {

    public static final String KEY = "test-failing";

    private static final SettingsSpec SETTINGS = SettingsSpec.builder().build();

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Test failing";
    }

    @Override
    public String description() {
        return "Always fails.";
    }

    @Override
    public JobDefaults defaults() {
        return new JobDefaults(false, "0 3 * * *", null);
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    @Override
    public JobResult run(JobContext ctx) {
        throw new IllegalStateException("boom");
    }
}
