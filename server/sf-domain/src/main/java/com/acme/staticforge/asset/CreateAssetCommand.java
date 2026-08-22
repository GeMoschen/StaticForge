package com.acme.staticforge.asset;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** Command to create a new asset (spec §21.3). */
public record CreateAssetCommand(
        long projectId,
        AssetType type,
        String displayName,
        UUID parentFolderUuid,
        JsonNode initialPayload,
        UUID templateUuid) {}
