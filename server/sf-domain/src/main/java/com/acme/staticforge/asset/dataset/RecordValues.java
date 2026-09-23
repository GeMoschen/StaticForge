package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Builds the {@link RecordView} of a record version (M19.3.2) — the one shape a record has for the
 * query model, dataset loops, {@code record:} values and dereferenced references, in generation and
 * preview alike.
 */
public final class RecordValues {

    private RecordValues() {}

    /**
     * @param storedFolderPath the version's {@code folder_path} — its record set's Content folder (M25)
     * @param recordSetUid the uid of the record set holding the record ({@code folder_id}), {@code null}
     *     when unknown
     * @param payload the record payload ({@code {datasetRef, content}})
     */
    public static RecordView view(
            UUID uuid, String uid, String displayName, String storedFolderPath, String recordSetUid, Instant changedAt,
            JsonNode payload) {
        return new RecordView(
                uuid,
                uid,
                displayName,
                ContentStorePaths.relative(storedFolderPath),
                recordSetUid,
                changedAt,
                payload == null ? null : payload.get("content"));
    }

    /**
     * The uids of the record sets holding {@code versions} (their {@code folder_id}s), in one lookup:
     * set asset id → uid.
     */
    public static Map<Long, String> recordSetUids(AssetRepository assets, Collection<AssetVersion> versions) {
        Set<Long> setIds = new HashSet<>();
        versions.forEach(version -> {
            if (version.getFolderId() != null) {
                setIds.add(version.getFolderId());
            }
        });
        Map<Long, String> uids = new HashMap<>();
        if (!setIds.isEmpty()) {
            assets.findAllById(setIds).forEach(asset -> uids.put(asset.getId(), asset.getUid()));
        }
        return uids;
    }

    /** The dataset a record payload belongs to, or {@code null} when absent or malformed. */
    public static UUID datasetRef(JsonNode payload) {
        JsonNode ref = payload == null ? null : payload.get("datasetRef");
        if (ref == null || !ref.isTextual()) {
            return null;
        }
        try {
            return UUID.fromString(ref.asText());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
