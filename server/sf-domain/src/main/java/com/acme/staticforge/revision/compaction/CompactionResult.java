package com.acme.staticforge.revision.compaction;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/**
 * What one compaction of one project did (M29.4.2), or would do in a dry run: a dry run and the real run that follows
 * it report the same numbers when nothing changed in between.
 *
 * @param versionsInWindow closed versions whose revision is older than the cutoff (the candidates)
 * @param assetsTouched assets that lost at least one version
 * @param versionsRemoved versions deleted, each absorbed by the next survivor of its day
 * @param referencesRewritten {@code asset_reference} rows deleted or re-bounded
 * @param revisionsMarked revisions newly flagged {@code compacted}
 * @param bytesFreed the serialized payload size of the removed versions (blob bytes are freed by the next
 *     {@code blob-sweep}, not counted here)
 * @param sample up to {@value com.acme.staticforge.housekeeping.JobContext#MAX_SAMPLE} removed versions,
 *     {@code "<asset uuid>@r<valid_from>"}
 */
public record CompactionResult(
        long versionsInWindow,
        long assetsTouched,
        long versionsRemoved,
        long referencesRewritten,
        long revisionsMarked,
        long bytesFreed,
        List<String> sample) {

    public static final CompactionResult EMPTY = new CompactionResult(0, 0, 0, 0, 0, 0, List.of());

    public CompactionResult {
        sample = sample == null ? List.of() : List.copyOf(sample);
    }

    /** The counters as a JSON object (the job's per-project report entry, without the sample). */
    public ObjectNode countsJson() {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.put("versionsInWindow", versionsInWindow);
        node.put("assetsTouched", assetsTouched);
        node.put("versionsRemoved", versionsRemoved);
        node.put("referencesRewritten", referencesRewritten);
        node.put("revisionsMarked", revisionsMarked);
        node.put("bytesFreed", bytesFreed);
        return node;
    }

    /** The counters of a report entry written by {@link #countsJson()}; missing numbers read as 0. */
    public static CompactionResult fromCounts(JsonNode node) {
        return new CompactionResult(
                node.path("versionsInWindow").asLong(),
                node.path("assetsTouched").asLong(),
                node.path("versionsRemoved").asLong(),
                node.path("referencesRewritten").asLong(),
                node.path("revisionsMarked").asLong(),
                node.path("bytesFreed").asLong(),
                List.of());
    }
}
