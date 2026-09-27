package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;

/**
 * Client-facing generation target (spec §18.4, §20.2). {@code outputPath} is the target's output
 * directory relative to the server's output root (e.g. {@code acme/site}); the absolute server path is
 * never exposed. {@code uuid} (M27.8.1) is its stable identity, which export archives and their schedules name.
 * {@code redirectFormats} (M30.5.1) are the redirect outputs its builds write — {@code config.redirectFormats}, or
 * {@code ["HTML_STUB"]} when the config doesn't set it; {@code HTACCESS} works on Apache hosts only.
 */
public record GenerationTargetView(
        Long id,
        UUID uuid,
        String name,
        String type,
        JsonNode config,
        boolean isDefault,
        String outputPath,
        List<String> redirectFormats) {}
