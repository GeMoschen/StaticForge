package com.acme.staticforge.asset;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Materialized outgoing edge of an asset version (spec §5.4). The reverse edges power
 * the usage view, incremental generation and broken-link reports. References are stored
 * by UUID and the {@code toAssetId} is the internal asset id.
 */
@Entity
@Table(name = "asset_reference")
public class AssetReference {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "from_asset_id", nullable = false)
    private Long fromAssetId;

    /** Inclusive start; like {@code AssetVersion}'s, only revision compaction (JDBC) ever moves it (M29.4.2). */
    @Column(name = "valid_from_revision", nullable = false, updatable = false)
    private Long validFromRevision;

    @Column(name = "valid_to_revision")
    private Long validToRevision;

    @Column(name = "to_asset_id", nullable = false)
    private Long toAssetId;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, length = 30)
    private ReferenceKind kind;

    @Column(name = "source_path", length = 500)
    private String sourcePath;

    protected AssetReference() {}

    public AssetReference(Long fromAssetId, Long validFromRevision, Long toAssetId, ReferenceKind kind,
            String sourcePath) {
        this.fromAssetId = fromAssetId;
        this.validFromRevision = validFromRevision;
        this.toAssetId = toAssetId;
        this.kind = kind;
        this.sourcePath = sourcePath;
    }

    public Long getId() {
        return id;
    }

    public Long getFromAssetId() {
        return fromAssetId;
    }

    public Long getValidFromRevision() {
        return validFromRevision;
    }

    public Long getValidToRevision() {
        return validToRevision;
    }

    public void setValidToRevision(Long validToRevision) {
        this.validToRevision = validToRevision;
    }

    public Long getToAssetId() {
        return toAssetId;
    }

    public ReferenceKind getKind() {
        return kind;
    }

    public String getSourcePath() {
        return sourcePath;
    }
}
