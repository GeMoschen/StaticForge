package com.acme.staticforge.asset.media;

/**
 * Content-addressed byte-storage backend (spec §11.2). Implementations store the raw bytes of
 * a media file keyed purely by their SHA-256 digest, so identical content is stored exactly
 * once regardless of how many assets reference it. Byte I/O is platform-dependent (filesystem,
 * object storage); the {@code blob} database row and its {@code ref_count} are managed by
 * {@link MediaService}, not by a {@link BlobStore}.
 */
public interface BlobStore {

    /** Persists {@code bytes} under {@code sha256} (idempotent: a no-op when already present). */
    void put(String sha256, byte[] bytes);

    /** Returns the stored bytes for {@code sha256}, or throws when absent. */
    byte[] get(String sha256);

    /** {@code true} when bytes already exist for {@code sha256}. */
    boolean exists(String sha256);

    /** Removes the bytes for {@code sha256}; invoked only by the nightly sweep. */
    void delete(String sha256);

    /** The backend-specific storage key (relative path or object key) for {@code sha256}. */
    String storageKey(String sha256);
}
