package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Serialized state of a single {@code GenerationTarget} in the {@code settings.json}
 * payload of an export archive (feature `selective-export`, `M10.1.2`). {@code config} is
 * redacted (see {@link ProjectExportImportServiceImpl}'s redaction pass) before it lands
 * here — no credential material (e.g. S3 access keys) is ever exported.
 */
public record ExportedGenerationTarget(String name, String type, JsonNode config, boolean isDefault) {}
