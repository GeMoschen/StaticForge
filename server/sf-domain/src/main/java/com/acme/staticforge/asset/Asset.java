package com.acme.staticforge.asset;

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
 * Asset identity row (spec §5.2). One row per asset for its entire lifetime; the
 * identity columns are never updated (with the sole exception of {@code uid} on an
 * explicit rename — recorded as a revisioned change).
 *
 * <p>{@code uuid} is unique per {@code (projectId, uuid)}, not server-wide — enforced by a
 * DB unique constraint ({@code uq_asset_project_uuid}, feature `09-m9-project-scoped-uuids`)
 * rather than JPA metadata, matching how {@code UrlRegistryEntry}'s composite tuple
 * constraint is likewise DB-only. The same UUID may legitimately exist in two different
 * projects; every lookup must go through {@link AssetRepository#findByProjectIdAndUuid}.
 */
@Entity
@Table(name = "asset")
public class Asset {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "uuid", nullable = false)
    private UUID uuid;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "asset_type", nullable = false, length = 30)
    private AssetType assetType;

    @Column(name = "uid", nullable = false, length = 120)
    private String uid;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false)
    private Long createdBy;

    protected Asset() {}

    public Asset(UUID uuid, Long projectId, AssetType assetType, String uid, Instant createdAt, Long createdBy) {
        this.uuid = uuid;
        this.projectId = projectId;
        this.assetType = assetType;
        this.uid = uid;
        this.createdAt = createdAt;
        this.createdBy = createdBy;
    }

    public Long getId() {
        return id;
    }

    public UUID getUuid() {
        return uuid;
    }

    public Long getProjectId() {
        return projectId;
    }

    public AssetType getAssetType() {
        return assetType;
    }

    public String getUid() {
        return uid;
    }

    public void setUid(String uid) {
        this.uid = uid;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Long getCreatedBy() {
        return createdBy;
    }
}
