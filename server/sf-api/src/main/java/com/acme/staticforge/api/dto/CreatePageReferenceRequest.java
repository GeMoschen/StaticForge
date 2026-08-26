package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * Create-{@code PageReference} request body. {@code targetKind} is {@code PAGE} or
 * {@code FOLDER}; {@code label} is an optional override of the target's display name.
 */
public record CreatePageReferenceRequest(
        String displayName, UUID folderUuid, String targetKind, UUID targetAssetUuid, String label) {}
