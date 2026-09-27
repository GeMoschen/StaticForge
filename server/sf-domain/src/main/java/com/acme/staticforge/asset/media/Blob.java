package com.acme.staticforge.asset.media;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A content-addressed blob of stored media bytes (spec §11.2). The SHA-256 digest is the
 * immutable primary key, so re-uploading identical bytes references the same row instead of
 * duplicating storage.
 *
 * <p>Blobs are collected by the {@code blob-sweep} job (M29.2.3, mark and sweep): a blob that no version of any
 * revision, no {@code media_variant} row and no generation run references, and that was neither created nor
 * referenced by a write within the grace period ({@link #lastReferencedAt}), is deleted with its bytes.
 * {@link #refCount} is <em>derived and informational</em>: writers increment it, the sweep recomputes it to the
 * number of references it found. No code path may decide a deletion by it.
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

    /** When a write last created or reused the blob ({@link BlobWriter}); {@code null} before M29.2.3. */
    @Column(name = "last_referenced_at")
    private Instant lastReferencedAt;

    protected Blob() {}

    public Blob(String sha256, long sizeBytes, String mimeType, String storageKey, long refCount, Instant createdAt) {
        this.sha256 = sha256;
        this.sizeBytes = sizeBytes;
        this.mimeType = mimeType;
        this.storageKey = storageKey;
        this.refCount = refCount;
        this.createdAt = createdAt;
        this.lastReferencedAt = createdAt;
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

    public Instant getLastReferencedAt() {
        return lastReferencedAt;
    }

    public void setLastReferencedAt(Instant lastReferencedAt) {
        this.lastReferencedAt = lastReferencedAt;
    }
}
