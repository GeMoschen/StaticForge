package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Client-facing generation target (spec §18.4, §20.2). {@code outputPath} is the target's output
 * directory relative to the server's output root (e.g. {@code acme/site}); the absolute server path is
 * never exposed. {@code uuid} (M27.8.1) is its stable identity, which export archives and their schedules name.
 */
public record GenerationTargetView(
        Long id, UUID uuid, String name, String type, JsonNode config, boolean isDefault, String outputPath) {}
