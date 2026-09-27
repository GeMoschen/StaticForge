package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * The persisted state of one system job (M29.1.1, epic decisions 2–3): the admin's schedule and settings, when it is
 * next due and who holds its lease. Seeded from the job's defaults on the first start; a row whose job bean is gone is
 * kept and shown as orphaned, and never runs.
 *
 * <p>The lease columns and {@code last_run_id} belong to the {@link SystemJobRunner}, which writes them with
 * conditional JDBC updates ({@link com.acme.staticforge.scheduler.LeaseClaimer}); the entity reads them but never
 * writes them, so an admin's edit can't overwrite a lease renewed in the meantime. {@code version} is the optimistic
 * lock the claim, the runner and the API all respect.
 */
@Entity
@Table(name = "system_job")
public class SystemJob {

    // `key` is a reserved word in H2, so Hibernate must quote it (see OutputChannel).
    @Id
    @Column(name = "`key`", nullable = false, length = 64, updatable = false)
    private String key;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "cron", nullable = false, length = 120)
    private String cron;

    @Column(name = "zone_id", nullable = false, length = 64)
    private String zoneId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "settings", nullable = false)
    private JsonNode settings;

    @Column(name = "next_run_at")
    private Instant nextRunAt;

    @Column(name = "lease_owner", length = 120, insertable = false, updatable = false)
    private String leaseOwner;

    @Column(name = "lease_until", insertable = false, updatable = false)
    private Instant leaseUntil;

    @Column(name = "last_run_id", insertable = false, updatable = false)
    private Long lastRunId;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by")
    private Long updatedBy;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    protected SystemJob() {}

    public SystemJob(String key, boolean enabled, String cron, String zoneId, JsonNode settings, Instant updatedAt) {
        this.key = key;
        this.enabled = enabled;
        this.cron = cron;
        this.zoneId = zoneId;
        this.settings = settings;
        this.updatedAt = updatedAt;
    }

    public String getKey() {
        return key;
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

    public String getZoneId() {
        return zoneId;
    }

    public void setZoneId(String zoneId) {
        this.zoneId = zoneId;
    }

    /** A copy of the settings. */
    public JsonNode getSettings() {
        return settings == null ? null : settings.deepCopy();
    }

    public void setSettings(JsonNode settings) {
        this.settings = settings == null ? null : settings.deepCopy();
    }

    public Instant getNextRunAt() {
        return nextRunAt;
    }

    public void setNextRunAt(Instant nextRunAt) {
        this.nextRunAt = nextRunAt;
    }

    public String getLeaseOwner() {
        return leaseOwner;
    }

    public Instant getLeaseUntil() {
        return leaseUntil;
    }

    /** Whether a node holds the job's lease at {@code now}: the job is running. */
    public boolean isLeased(Instant now) {
        return leaseOwner != null && leaseUntil != null && leaseUntil.isAfter(now);
    }

    public Long getLastRunId() {
        return lastRunId;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public Long getUpdatedBy() {
        return updatedBy;
    }

    public void setUpdatedBy(Long updatedBy) {
        this.updatedBy = updatedBy;
    }

    /** The optimistic-lock version; {@code 0} before the row is stored. */
    public long getVersion() {
        return version == null ? 0 : version;
    }
}
