package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * Builds the {@link RecordView} of a record version (M19.3.2) — the one shape a record has for the
 * query model, dataset loops, {@code record:} values and dereferenced references, in generation and
 * preview alike.
 */
public final class RecordValues {

    private RecordValues() {}

    /**
     * @param storedFolderPath the version's {@code folder_path}
     * @param payload the record payload ({@code {datasetRef, content}})
     */
    public static RecordView view(
            UUID uuid, String uid, String displayName, String storedFolderPath, Instant changedAt, JsonNode payload) {
        return new RecordView(
                uuid,
                uid,
                displayName,
                ContentStorePaths.relative(storedFolderPath),
                changedAt,
                payload == null ? null : payload.get("content"));
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
