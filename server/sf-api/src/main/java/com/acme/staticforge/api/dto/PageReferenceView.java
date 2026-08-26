package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Full {@code PageReference} representation (§ M8.1.5), mirroring {@code PageView}'s shape conventions. */
public record PageReferenceView(
        UUID uuid,
        String uid,
        String displayName,
        long revision,
        String folderPath,
        String targetKind,
        UUID targetAssetUuid,
        String label) {}
