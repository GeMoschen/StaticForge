package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Update-{@code PageReference} request body — replaces {@code target} and {@code label}. */
public record UpdatePageReferenceRequest(String targetKind, UUID targetAssetUuid, String label) {}
