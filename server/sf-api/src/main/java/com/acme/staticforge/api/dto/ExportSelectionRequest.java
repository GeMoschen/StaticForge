package com.acme.staticforge.api.dto;

import java.util.Set;

/**
 * {@code POST .../export/selection} request body. {@code assetUuids} are raw string UUIDs
 * (parsed and validated by the controller); {@code includeChannels}/{@code
 * includeGenerationTargets} mirror {@code ExportSelection}'s project-settings flags.
 * {@code fullStores} (feature `full-store-export`, `M11.1.3`) holds raw strings matching
 * {@code FolderScope} enum names (e.g. {@code "PAGES"}, {@code "MEDIA"}, {@code
 * "NAVIGATION"}), converted and validated by the controller.
 */
public record ExportSelectionRequest(
        Set<String> assetUuids, boolean includeChannels, boolean includeGenerationTargets, Set<String> fullStores) {}
