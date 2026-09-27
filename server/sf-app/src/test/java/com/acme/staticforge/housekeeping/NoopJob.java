package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * A test job registered as a bean (M29.1.1; test sources only): seeded from {@code sf.housekeeping.test-noop.*},
 * disabled by default so the application's runner never schedules it, dry-run capable. A run examines 3 items, samples
 * them and — unless a dry run — affects 2 and frees 2 KiB; the report gets a per-project breakdown.
 */
@Component
public class NoopJob implements HousekeepingJob {

    public static final String KEY = "test-noop";

    static final SettingsSpec SETTINGS = SettingsSpec.builder()
            .integer("batchSize", 1, 10_000)
            .duration("grace", Duration.ofMinutes(1), null)
            .build();

    private final Properties properties;

    public NoopJob(Properties properties) {
        this.properties = properties;
    }

    /** {@code sf.housekeeping.test-noop.*}. */
    @Component
    @ConfigurationProperties(prefix = "sf.housekeeping.test-noop")
    public static class Properties extends JobProperties {

        /** Items per batch. */
        private int batchSize = 100;

        /** How old an item must be. */
        private Duration grace = Duration.ofHours(1);

        public Properties() {
            super(false, "0 3 * * *");
        }

        public int getBatchSize() {
            return batchSize;
        }

        public void setBatchSize(int batchSize) {
            this.batchSize = batchSize;
        }

        public Duration getGrace() {
            return grace;
        }

        public void setGrace(Duration grace) {
            this.grace = grace;
        }
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Test no-op";
    }

    @Override
    public String description() {
        return "Does nothing, reports a little.";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> settings
                .put("batchSize", properties.getBatchSize())
                .put("grace", properties.getGrace().toString()));
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    @Override
    public boolean supportsDryRun() {
        return true;
    }

    @Override
    public JobResult run(JobContext ctx) {
        ctx.settings().duration("grace");
        ctx.examined(3);
        for (int i = 1; i <= 3; i++) {
            ctx.sample("item-" + i);
        }
        if (!ctx.dryRun()) {
            ctx.affected(2);
            ctx.bytesFreed(2048);
        }
        ctx.report().putObject("projects").put("demo", 3);
        return JobResult.succeeded();
    }
}
