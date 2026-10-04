package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * Update-{@code PageReference} request body — replaces {@code target} and {@code label}. {@code visibleInMenu} is the
 * "Visible in menu" flag: {@code null} leaves it as stored. A body with <b>only</b> {@code visibleInMenu} (no
 * {@code targetKind} and no {@code targetAssetUuid}) is a partial update: target and label stay as they are.
 */
public record UpdatePageReferenceRequest(String targetKind, UUID targetAssetUuid, String label, Boolean visibleInMenu) {}
