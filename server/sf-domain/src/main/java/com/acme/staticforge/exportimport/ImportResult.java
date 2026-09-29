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
 *
 * <p>M30.4.1: {@code importedRedirectCount} redirects added, and {@code redirectWarnings} — the archive's redirects
 * left out ({@link ConflictType#REDIRECT_SOURCE_EXISTS}, {@link ConflictType#REDIRECT_INVALID}).
 *
 * <p>M32.6: {@code importedUrlCount} URL registry rows written, and {@code urlWarnings} — the rows left out
 * ({@link ConflictType#URL_OVERRIDE_KEPT}, {@link ConflictType#URL_TAKEN}, {@link ConflictType#URL_INVALID}).
 */
public record ImportResult(
        String sourceProjectKey, int importedAssetCount, int updatedAssetCount, int importedBlobCount,
        int releasedCount, int importedScheduleCount, int updatedScheduleCount, List<ImportConflict> scheduleWarnings,
        int importedRedirectCount, List<ImportConflict> redirectWarnings, int importedUrlCount,
        List<ImportConflict> urlWarnings) {

    public ImportResult(
            String sourceProjectKey, int importedAssetCount, int updatedAssetCount, int importedBlobCount,
            int releasedCount, int importedScheduleCount, int updatedScheduleCount, List<ImportConflict> scheduleWarnings,
            int importedRedirectCount, List<ImportConflict> redirectWarnings) {
        this(sourceProjectKey, importedAssetCount, updatedAssetCount, importedBlobCount, releasedCount,
                importedScheduleCount, updatedScheduleCount, scheduleWarnings, importedRedirectCount, redirectWarnings, 0,
                List.of());
    }

    /** A result without schedules and redirects. */
    public ImportResult(
            String sourceProjectKey, int importedAssetCount, int updatedAssetCount, int importedBlobCount,
            int releasedCount) {
        this(sourceProjectKey, importedAssetCount, updatedAssetCount, importedBlobCount, releasedCount, 0, 0, List.of(),
                0, List.of());
    }
}
