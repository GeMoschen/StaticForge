package com.acme.staticforge.scheduler;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A project action that runs at a time ({@link #getRunAt()}) or on a cron in a time zone (M27.4.1, epic decisions
 * 20–26). {@link #getNextRunAt()} is the UTC instant it is next due; {@code null} once it is done, cancelled or
 * paused. A node executes it only after claiming its lease ({@link LeaseClaimer}); {@code version} is the optimistic
 * lock the claim, the engine and the API all respect.
 *
 * <p>{@code type} is a {@link ScheduledActionHandler#type()} and stays a string so a new action type is a new handler
 * bean, with no schema change; {@code params} is that handler's own, validated shape.
 *
 * <p>{@code uuid} (M27.8.1) is the action's stable identity, unique per project: an export archive names it, and a
 * re-import of that archive replaces the action it names.
 */
@Entity
@Table(name = "scheduled_action")
public class ScheduledAction {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(name = "uuid", nullable = false, updatable = false)
    private UUID uuid;

    @Column(name = "type", nullable = false, length = 40)
    private String type;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "params", nullable = false)
    private JsonNode params;

    @Column(name = "run_at")
    private Instant runAt;

    @Column(name = "cron", length = 120)
    private String cron;

    @Column(name = "zone_id", length = 64)
    private String zoneId;

    @Enumerated(EnumType.STRING)
    @Column(name = "pin_policy", length = 20)
    private PinPolicy pinPolicy;

    @Enumerated(EnumType.STRING)
    @Column(name = "missed_policy", nullable = false, length = 30)
    private MissedPolicy missedPolicy;

    @Column(name = "max_lateness_seconds")
    private Long maxLatenessSeconds;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "then_generate")
    private JsonNode thenGenerate;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private ActionStatus status;

    @Column(name = "next_run_at")
    private Instant nextRunAt;

    @Column(name = "lease_owner", length = 120)
    private String leaseOwner;

    @Column(name = "lease_until")
    private Instant leaseUntil;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "owner_user_id", nullable = false)
    private Long ownerUserId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    protected ScheduledAction() {}

    public ScheduledAction(long projectId, String type, Long createdBy, Instant createdAt) {
        this(projectId, UUID.randomUUID(), type, createdBy, createdBy, createdAt);
    }

    /** An action with a given identity, creator and owner: an imported one (M27.8.1). */
    public ScheduledAction(long projectId, UUID uuid, String type, Long createdBy, Long ownerUserId, Instant createdAt) {
        this.projectId = projectId;
        this.uuid = uuid;
        this.type = type;
        this.createdBy = createdBy;
        this.ownerUserId = ownerUserId;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
        this.status = ActionStatus.PENDING;
        this.missedPolicy = MissedPolicy.RUN_LATE;
    }

    /** Whether this action runs on a cron (else once, at {@link #getRunAt()}). */
    public boolean isRecurring() {
        return cron != null;
    }

    /** The lateness bound of {@link MissedPolicy#SKIP_IF_LATER_THAN}; {@code null} for {@link MissedPolicy#RUN_LATE}. */
    public Duration getMaxLateness() {
        return maxLatenessSeconds == null ? null : Duration.ofSeconds(maxLatenessSeconds);
    }

    public void setMaxLateness(Duration maxLateness) {
        this.maxLatenessSeconds = maxLateness == null ? null : maxLateness.toSeconds();
    }

    public Long getId() {
        return id;
    }

    public Long getProjectId() {
        return projectId;
    }

    public UUID getUuid() {
        return uuid;
    }

    public String getType() {
        return type;
    }

    public JsonNode getParams() {
        return params;
    }

    public void setParams(JsonNode params) {
        this.params = params;
    }

    public Instant getRunAt() {
        return runAt;
    }

    public void setRunAt(Instant runAt) {
        this.runAt = runAt;
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

    public PinPolicy getPinPolicy() {
        return pinPolicy;
    }

    public void setPinPolicy(PinPolicy pinPolicy) {
        this.pinPolicy = pinPolicy;
    }

    public MissedPolicy getMissedPolicy() {
        return missedPolicy;
    }

    public void setMissedPolicy(MissedPolicy missedPolicy) {
        this.missedPolicy = missedPolicy;
    }

    public JsonNode getThenGenerate() {
        return thenGenerate;
    }

    public void setThenGenerate(JsonNode thenGenerate) {
        this.thenGenerate = thenGenerate;
    }

    public ActionStatus getStatus() {
        return status;
    }

    public void setStatus(ActionStatus status) {
        this.status = status;
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

    /** Drops the lease: the action can be claimed again once due. */
    public void clearLease() {
        this.leaseOwner = null;
        this.leaseUntil = null;
    }

    public Long getCreatedBy() {
        return createdBy;
    }

    public Long getOwnerUserId() {
        return ownerUserId;
    }

    public void setOwnerUserId(Long ownerUserId) {
        this.ownerUserId = ownerUserId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public long getVersion() {
        return version;
    }
}
