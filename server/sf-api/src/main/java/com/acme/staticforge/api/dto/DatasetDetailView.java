package com.acme.staticforge.api.dto;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One dataset schema in full (M19.2.1): the CDL source, the compiled definition the record form and
 * grid columns are driven by, and the live record count. {@code revision} is also {@code ETag: "rev-{n}"}.
 *
 * <p>{@code channelTemplates} (M25.2.1) holds the per-channel record templates,
 * {@code {<channel>: {source, compiledHash}}} (an empty object when there are none).
 * {@code recordTemplateDiagnostics} carries the compile warnings of each record template by channel on a
 * create/update response; it is empty on reads.
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
        JsonNode channelTemplates,
        Map<String, List<Diagnostic>> recordTemplateDiagnostics,
        long recordCount,
        long revision,
        boolean deleted) {}
