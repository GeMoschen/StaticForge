package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Read model of one dataset schema at a single revision (M19.1.2). {@code recordCount} counts the
 * current, live records (it is not revision-pinned); {@code revision} is the version's
 * {@code validFromRevision}, the {@code ETag: "rev-{n}"} concurrency token.
 *
 * <p>{@code channelTemplates} (M25.2.1) is the stored per-channel record templates,
 * {@code {<channel>: {source, compiledHash}}} — an empty object when the dataset has none.
 *
 * <p>{@code brokenRecordSets} is the warning of a schema save (M25.1.2): the dataset's sets whose stored
 * query no longer validates against the saved schema (a field they read was removed or retyped). The save
 * succeeded; those sets render no records until their query is fixed. {@code recordTemplateDiagnostics}
 * (M25.2.1) holds the compile warnings of each saved record template by channel (errors reject the save).
 * Both are empty on every other read — a set's own view reports its state ({@link RecordSetView#queryValid()}).
 */
public record DatasetView(
        UUID uuid,
        String uid,
        String displayName,
        UUID folderUuid,
        String folderPath,
        CdlSources cdl,
        JsonNode compiledDefinition,
        String titleEditor,
        String description,
        JsonNode channelTemplates,
        long recordCount,
        long revision,
        java.time.Instant changedAt,
        boolean deleted,
        List<BrokenRecordSet> brokenRecordSets,
        Map<String, List<Diagnostic>> recordTemplateDiagnostics) {

    public DatasetView {
        brokenRecordSets = brokenRecordSets == null ? List.of() : List.copyOf(brokenRecordSets);
        recordTemplateDiagnostics = recordTemplateDiagnostics == null
                ? Map.of()
                : Collections.unmodifiableMap(new TreeMap<>(recordTemplateDiagnostics));
    }

    /** This view with the save's {@code brokenRecordSets} warning. */
    public DatasetView withBrokenRecordSets(List<BrokenRecordSet> sets) {
        return new DatasetView(
                uuid, uid, displayName, folderUuid, folderPath, cdl, compiledDefinition, titleEditor,
                description, channelTemplates, recordCount, revision, changedAt, deleted, sets, recordTemplateDiagnostics);
    }

    /** This view with the save's record template compile warnings, by channel. */
    public DatasetView withRecordTemplateDiagnostics(Map<String, List<Diagnostic>> diagnostics) {
        return new DatasetView(
                uuid, uid, displayName, folderUuid, folderPath, cdl, compiledDefinition, titleEditor,
                description, channelTemplates, recordCount, revision, changedAt, deleted, brokenRecordSets, diagnostics);
    }
}
