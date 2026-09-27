package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.function.Consumer;

/**
 * A job's defaults (M29.1.1, epic decision 3): what the first start seeds into its {@code system_job} row and what
 * <em>Reset to defaults</em> restores. Built from the job's {@code sf.housekeeping.<key>.*} block, see
 * {@link JobProperties}. The cron zone is not part of it: every job's default zone is {@code sf.housekeeping.zone}.
 *
 * @param enabled whether the job runs on its cron
 * @param cron a five-field (or six-field, seconds first) cron expression, see
 *     {@link com.acme.staticforge.scheduler.ScheduleTiming}
 * @param settings the job's own settings; must pass {@link HousekeepingJob#validateSettings}
 */
public record JobDefaults(boolean enabled, String cron, ObjectNode settings) {

    public JobDefaults {
        settings = settings == null ? JsonNodeFactory.instance.objectNode() : settings.deepCopy();
    }

    @Override
    public ObjectNode settings() {
        return settings.deepCopy();
    }

    /** {@code enabled} and {@code cron} of {@code properties}, with the settings {@code settings} writes. */
    public static JobDefaults of(JobProperties properties, Consumer<ObjectNode> settings) {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        if (settings != null) {
            settings.accept(node);
        }
        return new JobDefaults(properties.isEnabled(), properties.getCron(), node);
    }
}
