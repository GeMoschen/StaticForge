package com.acme.staticforge.api.dto;

import com.acme.staticforge.asset.dataset.BrokenRecordSet;
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
 * create/update response; it is empty on reads. {@code brokenRecordSets} (M25.1.2) lists, on an update
 * response, the record sets of the dataset whose stored query no longer validates against the saved schema
 * (a removed or retyped field) — the save succeeded, those sets render nothing until fixed; empty otherwise.
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
        List<BrokenRecordSet> brokenRecordSets,
        long recordCount,
        long revision,
        boolean deleted) {}
