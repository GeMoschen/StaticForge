package com.acme.staticforge.asset;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * AssetVersion — the mutable state of an asset over a revision interval (spec §5.2,
 * §7.4, §22.2). Type-specific data lives in the {@code payload} JSON column; the fields
 * needed for queries and integrity are projected onto real columns.
 */
@Entity
@Table(name = "asset_version")
public class AssetVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "asset_id", nullable = false)
    private Long assetId;

    @Column(name = "valid_from_revision", nullable = false)
    private long validFromRevision;

    @Column(name = "valid_to_revision")
    private Long validToRevision;

    @Column(name = "deleted", nullable = false)
    private boolean deleted;

    @Column(name = "display_name", nullable = false, length = 200)
    private String displayName;

    @Column(name = "folder_id")
    private Long folderId;

    @Column(name = "folder_path", nullable = false, length = 1024)
    private String folderPath = "/";

    @Column(name = "template_asset_id")
    private Long templateAssetId;

    @Column(name = "mime_type", length = 150)
    private String mimeType;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload", nullable = false)
    private JsonNode payload;

    @Column(name = "changed_by", nullable = false)
    private Long changedBy;

    @Column(name = "changed_at", nullable = false)
    private Instant changedAt;

    /** Read-only association to the asset identity row, for JPQL joins in queries. */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "asset_id", insertable = false, updatable = false)
    private Asset asset;

    protected AssetVersion() {}

    public AssetVersion(Long assetId, long validFromRevision, String displayName, JsonNode payload,
            Long changedBy, Instant changedAt) {
        this.assetId = assetId;
        this.validFromRevision = validFromRevision;
        this.displayName = displayName;
        this.payload = payload;
        this.changedBy = changedBy;
        this.changedAt = changedAt;
    }

    public Long getId() {
        return id;
    }

    public Long getAssetId() {
        return assetId;
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

    public boolean isDeleted() {
        return deleted;
    }

    public void setDeleted(boolean deleted) {
        this.deleted = deleted;
    }

    public String getDisplayName() {
        return displayName;
    }

    public Long getFolderId() {
        return folderId;
    }

    public void setFolderId(Long folderId) {
        this.folderId = folderId;
    }

    public String getFolderPath() {
        return folderPath;
    }

    public void setFolderPath(String folderPath) {
        this.folderPath = folderPath;
    }

    public Long getTemplateAssetId() {
        return templateAssetId;
    }

    public void setTemplateAssetId(Long templateAssetId) {
        this.templateAssetId = templateAssetId;
    }

    public String getMimeType() {
        return mimeType;
    }

    public void setMimeType(String mimeType) {
        this.mimeType = mimeType;
    }

    public Long getSizeBytes() {
        return sizeBytes;
    }

    public void setSizeBytes(Long sizeBytes) {
        this.sizeBytes = sizeBytes;
    }

    public JsonNode getPayload() {
        return payload;
    }

    public Long getChangedBy() {
        return changedBy;
    }

    public Instant getChangedAt() {
        return changedAt;
    }

    public Asset getAsset() {
        return asset;
    }

    /**
     * Wires the transient {@code asset} association directly. {@code asset} is normally
     * populated only when Hibernate loads a row from the database (it's an insertable=false,
     * updatable=false read association); a freshly constructed-and-saved instance otherwise
     * keeps returning {@code null} from {@link #getAsset()} for the remainder of the same
     * persistence context/transaction, even after a query that would join-fetch it for a
     * reloaded row, because the session's identity map returns this very instance. Callers that
     * insert a new version and might have it observed via {@code getAsset()} later in the same
     * transaction (e.g. a JPQL query joining through {@code v.asset}) should set this eagerly.
     */
    public void setAsset(Asset asset) {
        this.asset = asset;
    }
}
