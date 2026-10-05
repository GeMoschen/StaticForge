package com.acme.staticforge.api.dto;

import java.util.UUID;

/** A duplicate: the new asset's identity and place; {@code revision} is its {@code ETag} token. */
public record AssetCopyView(
        UUID uuid, String uid, String type, String displayName, UUID folderUuid, String folderPath, long revision) {}
