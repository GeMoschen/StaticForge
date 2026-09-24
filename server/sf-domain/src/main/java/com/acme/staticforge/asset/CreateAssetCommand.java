package com.acme.staticforge.asset;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Command to create a new asset (spec §21.3). {@code uid} is derived from the display name when
 * {@code null}; an explicit one must be well-formed, unreserved and free for the type (M25).
 * {@code uuid} is generated when {@code null}; a caller presets it when the name or uid is made from it
 * (a record's, M25).
 */
public record CreateAssetCommand(
        long projectId,
        AssetType type,
        String displayName,
        UUID parentFolderUuid,
        JsonNode initialPayload,
        UUID templateUuid,
        String uid,
        UUID uuid) {

    /** A command with a generated uuid. */
    public CreateAssetCommand(
            long projectId,
            AssetType type,
            String displayName,
            UUID parentFolderUuid,
            JsonNode initialPayload,
            UUID templateUuid,
            String uid) {
        this(projectId, type, displayName, parentFolderUuid, initialPayload, templateUuid, uid, null);
    }

    /** A command whose uid is derived from the display name. */
    public CreateAssetCommand(
            long projectId,
            AssetType type,
            String displayName,
            UUID parentFolderUuid,
            JsonNode initialPayload,
            UUID templateUuid) {
        this(projectId, type, displayName, parentFolderUuid, initialPayload, templateUuid, null, null);
    }
}
