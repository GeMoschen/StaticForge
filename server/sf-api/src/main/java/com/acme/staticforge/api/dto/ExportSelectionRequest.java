package com.acme.staticforge.api.dto;

import java.util.Set;

/**
 * {@code POST .../export/selection} request body. {@code assetUuids} are raw string UUIDs
 * (parsed and validated by the controller); {@code includeChannels}/{@code
 * includeGenerationTargets} mirror {@code ExportSelection}'s project-settings flags.
 */
public record ExportSelectionRequest(Set<String> assetUuids, boolean includeChannels, boolean includeGenerationTargets) {}
