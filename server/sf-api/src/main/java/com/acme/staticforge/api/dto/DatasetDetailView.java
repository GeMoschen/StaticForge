package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * One dataset schema in full (M19.2.1): the CDL source, the compiled definition the record form and
 * grid columns are driven by, and the live record count. {@code revision} is also {@code ETag: "rev-{n}"}.
 */
public record DatasetDetailView(
        UUID uuid,
        String uid,
        String displayName,
        UUID folderUuid,
        String folderPath,
        String contentDefinition,
        JsonNode compiledDefinition,
        String titleEditor,
        String description,
        long recordCount,
        long revision,
        boolean deleted) {}
