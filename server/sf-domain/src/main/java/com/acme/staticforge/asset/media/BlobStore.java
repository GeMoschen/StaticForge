package com.acme.staticforge.asset.media;

import java.time.Instant;
import java.util.function.Consumer;

/**
 * Content-addressed byte-storage backend (spec §11.2). Implementations store the raw bytes of
 * a media file keyed purely by their SHA-256 digest, so identical content is stored exactly
 * once regardless of how many assets reference it. Byte I/O is platform-dependent (filesystem,
 * object storage); the {@code blob} database row is managed by {@link BlobWriter} (writes) and the
 * blob sweep (deletes), not by a {@link BlobStore}.
 */
public interface BlobStore {

    /** Persists {@code bytes} under {@code sha256} (idempotent: a no-op when already present). */
    void put(String sha256, byte[] bytes);

    /** Returns the stored bytes for {@code sha256}, or throws when absent. */
    byte[] get(String sha256);

    /** {@code true} when bytes already exist for {@code sha256}. */
    boolean exists(String sha256);

    /** Removes the bytes for {@code sha256} (idempotent); invoked only by the blob sweep (M29.2.3). */
    void delete(String sha256);

    /** The backend-specific storage key (relative path or object key) for {@code sha256}. */
    String storageKey(String sha256);

    /**
     * Calls {@code consumer} for every object in the store (the blob sweep's scan for bytes without a {@code blob} row,
     * M29.2.3): the filesystem walk, or {@code ListObjectsV2} over the prefix for object storage. Objects that aren't
     * blobs (temporary files, foreign keys) are skipped. The consumer may delete objects it has been handed.
     */
    void forEachObject(Consumer<StoredObject> consumer);

    /** One stored object: its hash, size and last modification. */
    record StoredObject(String sha256, long sizeBytes, Instant lastModified) {}
}
