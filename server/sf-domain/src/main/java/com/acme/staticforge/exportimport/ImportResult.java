package com.acme.staticforge.exportimport;

import java.util.List;

/**
 * Outcome of an import operation: the source project identity (for provenance), the number
 * of brand-new assets created, the number of pre-existing (same-UUID/same-type) assets
 * overwritten with the archive's content, the number of content-addressed blobs
 * recreated in the target project, and the number of release pointers opened (M27.5.1: one per asset and locale
 * released by a {@link ReleaseMode#KEEP} import).
 *
 * <p>M27.8.1: {@code importedScheduleCount} new schedules, {@code updatedScheduleCount} open schedules replaced, and
 * {@code scheduleWarnings} — what happened to the archive's schedules at commit time, which can differ from the
 * analysis (time passes, a pinned version turns out incomplete).
 */
public record ImportResult(
        String sourceProjectKey, int importedAssetCount, int updatedAssetCount, int importedBlobCount,
        int releasedCount, int importedScheduleCount, int updatedScheduleCount, List<ImportConflict> scheduleWarnings) {

    /** A result without schedules. */
    public ImportResult(
            String sourceProjectKey, int importedAssetCount, int updatedAssetCount, int importedBlobCount,
            int releasedCount) {
        this(sourceProjectKey, importedAssetCount, updatedAssetCount, importedBlobCount, releasedCount, 0, 0, List.of());
    }
}
