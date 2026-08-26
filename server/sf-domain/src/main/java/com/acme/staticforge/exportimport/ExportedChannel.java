package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Serialized state of a single {@code OutputChannel} in the {@code settings.json} payload
 * of an export archive (feature `selective-export`, `M10.1.2`). {@code settings} is
 * redacted (see {@link ProjectExportImportServiceImpl}'s redaction pass) before it lands
 * here — no credential material is ever exported.
 */
public record ExportedChannel(
        String key,
        String name,
        String fileExtension,
        String mimeType,
        String defaultEscaping,
        boolean enabled,
        boolean isDefault,
        Integer position,
        JsonNode settings) {}
