package com.acme.staticforge.urlregistry;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A registered URL changed outside a build (M32.5): an override, a reset or an import. An incremental build re-renders
 * the readers of every target changed since its base build started. A wide reset (a channel, an area, the project) has
 * no target: it may have changed any URL. {@code area} is {@code null} when both areas changed.
 */
@Entity
@Table(name = "url_registry_change")
public class UrlRegistryChange {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private long projectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "area", length = 20)
    private UrlArea area;

    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", length = 20)
    private UrlTargetType targetType;

    @Column(name = "target_uuid")
    private UUID targetUuid;

    @Column(name = "changed_at", nullable = false)
    private Instant changedAt;

    protected UrlRegistryChange() {}

    public UrlRegistryChange(long projectId, UrlArea area, UrlTargetType targetType, UUID targetUuid, Instant changedAt) {
        this.projectId = projectId;
        this.area = area;
        this.targetType = targetType;
        this.targetUuid = targetUuid;
        this.changedAt = changedAt;
    }

    public Long getId() {
        return id;
    }

    public long getProjectId() {
        return projectId;
    }

    public UrlArea getArea() {
        return area;
    }

    public UrlTargetType getTargetType() {
        return targetType;
    }

    public UUID getTargetUuid() {
        return targetUuid;
    }

    public Instant getChangedAt() {
        return changedAt;
    }

    /** Whether this change may have changed any URL of the area (a channel, area or project reset). */
    public boolean wide() {
        return targetUuid == null;
    }
}
