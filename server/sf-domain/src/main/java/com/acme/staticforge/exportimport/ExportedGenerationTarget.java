package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Serialized state of a single {@code GenerationTarget} in the {@code settings.json}
 * payload of an export archive (feature `selective-export`, `M10.1.2`). {@code config} is
 * redacted (see {@link ProjectExportImportServiceImpl}'s redaction pass) before it lands
 * here — no credential material (e.g. S3 access keys) is ever exported.
 *
 * <p>{@code uuid} (M27.8.1, protocol {@code 9}) is the target's identity, which the archive's schedules name; {@code
 * null} in older archives.
 */
public record ExportedGenerationTarget(String uuid, String name, String type, JsonNode config, boolean isDefault) {

    /** A target of an archive before protocol 9, which has no uuid. */
    public ExportedGenerationTarget(String name, String type, JsonNode config, boolean isDefault) {
        this(null, name, type, config, isDefault);
    }
}
