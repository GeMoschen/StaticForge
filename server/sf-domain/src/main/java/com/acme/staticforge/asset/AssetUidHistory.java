package com.acme.staticforge.asset;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** Append-only record of a UID change (spec §6.4). */
@Entity
@Table(name = "asset_uid_history")
public class AssetUidHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "asset_id", nullable = false)
    private Long assetId;

    @Column(name = "old_uid", nullable = false, length = 120)
    private String oldUid;

    @Column(name = "new_uid", nullable = false, length = 120)
    private String newUid;

    @Column(name = "revision", nullable = false)
    private Long revision;

    protected AssetUidHistory() {}

    public AssetUidHistory(Long assetId, String oldUid, String newUid, Long revision) {
        this.assetId = assetId;
        this.oldUid = oldUid;
        this.newUid = newUid;
        this.revision = revision;
    }

    public Long getId() {
        return id;
    }

    public Long getAssetId() {
        return assetId;
    }

    public String getOldUid() {
        return oldUid;
    }

    public String getNewUid() {
        return newUid;
    }

    public Long getRevision() {
        return revision;
    }
}
