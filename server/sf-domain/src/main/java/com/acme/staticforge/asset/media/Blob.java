package com.acme.staticforge.asset.media;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A content-addressed blob of stored media bytes (spec §11.2). The SHA-256 digest is the
 * immutable primary key, so re-uploading identical bytes references the same row instead of
 * duplicating storage. {@link #refCount} tracks live references; a blob becomes collectable
 * only when it hits zero <em>and</em> no retained revision still points at it, which the
 * nightly sweep (out of scope here) enforces.
 */
@Entity
@Table(name = "blob")
public class Blob {

    @Id
    @Column(name = "sha256", nullable = false, length = 64, columnDefinition = "char(64)")
    private String sha256;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(name = "mime_type", length = 150)
    private String mimeType;

    @Column(name = "storage_key", length = 500)
    private String storageKey;

    @Column(name = "ref_count", nullable = false)
    private long refCount;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected Blob() {}

    public Blob(String sha256, long sizeBytes, String mimeType, String storageKey, long refCount, Instant createdAt) {
        this.sha256 = sha256;
        this.sizeBytes = sizeBytes;
        this.mimeType = mimeType;
        this.storageKey = storageKey;
        this.refCount = refCount;
        this.createdAt = createdAt;
    }

    public String getSha256() {
        return sha256;
    }

    public long getSizeBytes() {
        return sizeBytes;
    }

    public String getMimeType() {
        return mimeType;
    }

    public String getStorageKey() {
        return storageKey;
    }

    public long getRefCount() {
        return refCount;
    }

    public void setRefCount(long refCount) {
        this.refCount = refCount;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
