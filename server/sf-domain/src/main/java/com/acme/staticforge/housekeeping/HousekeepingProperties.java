package com.acme.staticforge.housekeeping;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Typed binding for the instance-wide part of {@code sf.housekeeping.*} (M29.1.1, epic decisions 2–3).
 *
 * <p>Each job's own block ({@code sf.housekeeping.<key>.enabled}, {@code .cron} and job-specific keys) is a separate
 * {@code @ConfigurationProperties} class extending {@link JobProperties}, next to the job in its package — so jobs
 * are added without editing this class. Binding both is fine: this class ignores the nested job blocks.
 */
@Component
@ConfigurationProperties(prefix = "sf.housekeeping")
public class HousekeepingProperties {

    /**
     * Whether this node runs system jobs: on the scheduler's poll (which also needs {@code sf.scheduler.enabled}) and
     * once at startup. Rows are seeded and the admin API works either way. Off in the {@code test} profile: tests run
     * jobs through their own runners or the API.
     */
    private boolean enabled = true;

    /** The IANA zone new job rows evaluate their cron in (seeding and <em>Reset to defaults</em>). */
    private String zone = "UTC";

    /** How many runs of each job the history keeps; older ones are deleted after every run. At least 1. */
    private int historyPerJob = 200;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getZone() {
        return zone;
    }

    public void setZone(String zone) {
        this.zone = zone;
    }

    public int getHistoryPerJob() {
        return historyPerJob;
    }

    public void setHistoryPerJob(int historyPerJob) {
        this.historyPerJob = historyPerJob;
    }
}
