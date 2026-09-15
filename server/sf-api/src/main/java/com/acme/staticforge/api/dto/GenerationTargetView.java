package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Client-facing generation target (spec §18.4, §20.2). {@code outputPath} is the target's output
 * directory relative to the server's output root (e.g. {@code acme/site}); the absolute server path is
 * never exposed.
 */
public record GenerationTargetView(
        Long id, String name, String type, JsonNode config, boolean isDefault, String outputPath) {}
