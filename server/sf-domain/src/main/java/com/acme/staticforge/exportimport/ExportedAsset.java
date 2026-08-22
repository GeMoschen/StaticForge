package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Serialized state of a single asset in the {@code assets.json} payload of an export
 * archive. Identity (uuid/type/uid) is paired with the current version's mutable state
 * (payload, denormalized media columns) and the structural edges (parent folder and
 * template) as source UUIDs, so the importer can remap them to fresh imported UUIDs. The
 * {@code folderPath} column is carried so import can topologically order folders.
 */
public record ExportedAsset(
        String uuid,
        String type,
        String uid,
        String displayName,
        String parentFolderUuid,
        String folderPath,
        String templateUuid,
        JsonNode payload,
        String mimeType,
        Long sizeBytes) {}
