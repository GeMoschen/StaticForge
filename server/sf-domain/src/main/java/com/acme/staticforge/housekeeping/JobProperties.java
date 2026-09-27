package com.acme.staticforge.housekeeping;

/**
 * The common part of one job's {@code sf.housekeeping.<key>.*} block (M29.1.1, epic decision 3): {@code enabled} and
 * {@code cron}. Each job adds its own block as a subclass with the job's keys and passes its default schedule to the
 * constructor, so later jobs add properties without touching a shared class:
 *
 * <pre>{@code
 * @Component
 * @ConfigurationProperties(prefix = "sf.housekeeping.audit-purge")
 * public class AuditPurgeProperties extends JobProperties {
 *
 *     // How old an audit entry gets before it is purged (Javadoc in the real class).
 *     private Duration retention = Duration.ofDays(365);
 *
 *     public AuditPurgeProperties() {
 *         super(true, "0 4 * * *");
 *     }
 *     // getters and setters
 * }
 * }</pre>
 *
 * The job then answers {@link HousekeepingJob#defaults()} with {@link JobDefaults#of(JobProperties,
 * java.util.function.Consumer)}, writing its keys into the settings object (durations as ISO-8601 strings, see
 * {@link JobSettings}). The values only seed the job's row on the first start and on <em>Reset to defaults</em>; after
 * that the persisted row wins. Document each block's defaults in {@code application.yml} under
 * {@code sf.housekeeping}.
 */
public class JobProperties {

    /** Whether the job runs on its cron. A disabled job can still be run by hand. */
    private boolean enabled;

    /** When the job runs: a five-field cron evaluated in {@code sf.housekeeping.zone}. */
    private String cron;

    public JobProperties(boolean enabled, String cron) {
        this.enabled = enabled;
        this.cron = cron;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getCron() {
        return cron;
    }

    public void setCron(String cron) {
        this.cron = cron;
    }
}
