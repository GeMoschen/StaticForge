package com.acme.staticforge.asset.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;

/**
 * Read model of one dataset schema at a single revision (M19.1.2). {@code recordCount} counts the
 * current, live records (it is not revision-pinned); {@code revision} is the version's
 * {@code validFromRevision}, the {@code ETag: "rev-{n}"} concurrency token.
 *
 * <p>{@code brokenRecordSets} is the warning of a schema save (M25.1.2): the dataset's sets whose stored
 * query no longer validates against the saved schema (a field they read was removed or retyped). The save
 * succeeded; those sets render no records until their query is fixed. Empty on every other read — a set's
 * own view reports its state ({@link RecordSetView#queryValid()}).
 */
public record DatasetView(
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
        boolean deleted,
        List<BrokenRecordSet> brokenRecordSets) {

    public DatasetView {
        brokenRecordSets = brokenRecordSets == null ? List.of() : List.copyOf(brokenRecordSets);
    }

    /** This view with the save's {@code brokenRecordSets} warning. */
    public DatasetView withBrokenRecordSets(List<BrokenRecordSet> sets) {
        return new DatasetView(
                uuid, uid, displayName, folderUuid, folderPath, contentDefinition, compiledDefinition, titleEditor,
                description, recordCount, revision, deleted, sets);
    }
}
