package com.acme.staticforge.generate.snapshot;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * A point-in-time view of a single asset, resolved against one revision (spec §18.2) and, in the released view, one
 * locale (M27.2.1). {@code changedAt} is when that version was written (a record's {@code _changedAt}, M19.3.2);
 * {@code folderId} is the parent's asset id — a record's record set (its {@code _recordSet}, M25).
 *
 * <p>{@code deleted} means <em>absent from this view</em>: a tombstone, or — with {@code unreleased} — an asset that
 * exists at the revision but is not released in the view's locale. Every consumer that skips tombstones therefore
 * skips unreleased assets at exactly the same places (epic decision 17); an unreleased asset keeps its draft's
 * identity (uuid, type, uid, name) so a reference to it resolves and renders empty with {@code SF-GEN-0221} instead
 * of failing as unknown. The payload of an unreleased asset is the draft's and must never be published.
 */
public record SnapshotAsset(
        UUID uuid,
        long assetId,
        AssetType type,
        String uid,
        String displayName,
        String folderPath,
        JsonNode payload,
        boolean deleted,
        Instant changedAt,
        Long folderId,
        boolean unreleased) {

    public SnapshotAsset {
        if (unreleased && !deleted) {
            throw new IllegalArgumentException("An unreleased snapshot asset is absent: deleted must be true.");
        }
    }

    /** A snapshot asset that is present in its view or a tombstone — never "unreleased". */
    public SnapshotAsset(
            UUID uuid, long assetId, AssetType type, String uid, String displayName, String folderPath, JsonNode payload,
            boolean deleted, Instant changedAt, Long folderId) {
        this(uuid, assetId, type, uid, displayName, folderPath, payload, deleted, changedAt, folderId, false);
    }

    /** A snapshot asset without a change time or parent (tests and fixtures that don't read them). */
    public SnapshotAsset(
            UUID uuid, long assetId, AssetType type, String uid, String displayName, String folderPath, JsonNode payload,
            boolean deleted) {
        this(uuid, assetId, type, uid, displayName, folderPath, payload, deleted, null, null);
    }

    /** A snapshot asset without a parent (tests and fixtures that don't read it). */
    public SnapshotAsset(
            UUID uuid, long assetId, AssetType type, String uid, String displayName, String folderPath, JsonNode payload,
            boolean deleted, Instant changedAt) {
        this(uuid, assetId, type, uid, displayName, folderPath, payload, deleted, changedAt, null);
    }

    /** This asset as absent from a view because it isn't released in the view's locale. */
    public SnapshotAsset asUnreleased() {
        return new SnapshotAsset(uuid, assetId, type, uid, displayName, folderPath, payload, true, changedAt, folderId, true);
    }
}
