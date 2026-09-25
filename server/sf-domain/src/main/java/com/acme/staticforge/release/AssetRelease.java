package com.acme.staticforge.release;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * The release pointer of one editorial (asset, locale) over a revision interval (M27.1.1): which version — and
 * which uid, since a uid change writes no version — a build renders for that locale. Revisioned like
 * {@link com.acme.staticforge.asset.AssetReference}: valid in {@code [validFromRevision, validToRevision)}, open
 * while {@code validToRevision} is {@code null}. No open row means "not released in that locale".
 *
 * <p>{@code localeKey} is {@link ReleaseLocales#ALL} ({@code ""}) for a non-localized project and for
 * non-localized media, else a declared locale code.
 */
@Entity
@Table(name = "asset_release")
public class AssetRelease {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(name = "asset_id", nullable = false)
    private Long assetId;

    @Column(name = "locale_key", nullable = false, length = 35)
    private String localeKey;

    @Column(name = "released_version_id", nullable = false)
    private Long releasedVersionId;

    @Column(name = "released_uid", nullable = false, length = 120)
    private String releasedUid;

    @Column(name = "valid_from_revision", nullable = false)
    private long validFromRevision;

    @Column(name = "valid_to_revision")
    private Long validToRevision;

    @Column(name = "released_by")
    private Long releasedBy;

    @Column(name = "released_at", nullable = false)
    private Instant releasedAt;

    protected AssetRelease() {}

    public AssetRelease(
            Long projectId,
            Long assetId,
            String localeKey,
            Long releasedVersionId,
            String releasedUid,
            long validFromRevision,
            Long releasedBy,
            Instant releasedAt) {
        this.projectId = projectId;
        this.assetId = assetId;
        this.localeKey = localeKey;
        this.releasedVersionId = releasedVersionId;
        this.releasedUid = releasedUid;
        this.validFromRevision = validFromRevision;
        this.releasedBy = releasedBy;
        this.releasedAt = releasedAt;
    }

    public Long getId() {
        return id;
    }

    public Long getProjectId() {
        return projectId;
    }

    public Long getAssetId() {
        return assetId;
    }

    public String getLocaleKey() {
        return localeKey;
    }

    public Long getReleasedVersionId() {
        return releasedVersionId;
    }

    public String getReleasedUid() {
        return releasedUid;
    }

    public long getValidFromRevision() {
        return validFromRevision;
    }

    public Long getValidToRevision() {
        return validToRevision;
    }

    public void setValidToRevision(Long validToRevision) {
        this.validToRevision = validToRevision;
    }

    public Long getReleasedBy() {
        return releasedBy;
    }

    public Instant getReleasedAt() {
        return releasedAt;
    }

    /** {@code true} while this pointer is the current release state of its (asset, locale). */
    public boolean isOpen() {
        return validToRevision == null;
    }
}
