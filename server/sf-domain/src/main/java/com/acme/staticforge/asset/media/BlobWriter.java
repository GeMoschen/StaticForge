package com.acme.staticforge.asset.media;

import java.time.Clock;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Stores content-addressed bytes and their {@code blob} row (spec §11.2): the one write path for media uploads, text
 * media writes, variants and imports.
 *
 * <p><b>Interplay with the blob sweep (M29.2.3).</b> Identical bytes reuse the existing row: it is locked
 * ({@link BlobRepository#findForUpdate}), its {@code ref_count} incremented and {@code last_referenced_at} set to now.
 * The sweep deletes a blob only under the same lock, after re-checking that neither {@code created_at} nor
 * {@code last_referenced_at} is within its grace period. So either this write waits for the sweep's transaction and,
 * finding no row any more, stores the bytes again, or the sweep sees the fresh {@code last_referenced_at} and keeps
 * the blob. A new blob's row is inserted (and flushed) <em>before</em> its bytes are written: the sweep claims rowless
 * orphan bytes by inserting a placeholder row with the same key first, so a concurrent write of the same bytes either
 * waits for that claim to end (and then writes the bytes the sweep removed) or makes the claim fail. Bytes missing
 * under an existing row (a sweep that crashed between deleting the object and its row) are written again.
 *
 * <p>{@code ref_count} is informational (derived, recomputed by the sweep); nothing may delete by it.
 */
@Component
public class BlobWriter {

    private final BlobRepository blobs;
    private final BlobStore store;
    private final Clock clock;

    public BlobWriter(BlobRepository blobs, BlobStore store, Clock clock) {
        this.blobs = blobs;
        this.store = store;
        this.clock = clock;
    }

    /** Stores {@code bytes} under {@code sha256} (their SHA-256) in the caller's transaction (one is required). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void store(String sha256, byte[] bytes, String mimeType) {
        blobs.findForUpdate(sha256).ifPresentOrElse(
                existing -> {
                    existing.setRefCount(existing.getRefCount() + 1);
                    existing.setLastReferencedAt(clock.instant());
                    if (!store.exists(sha256)) {
                        store.put(sha256, bytes);
                    }
                },
                () -> {
                    blobs.saveAndFlush(
                            new Blob(sha256, bytes.length, mimeType, store.storageKey(sha256), 1, clock.instant()));
                    store.put(sha256, bytes);
                });
    }
}
