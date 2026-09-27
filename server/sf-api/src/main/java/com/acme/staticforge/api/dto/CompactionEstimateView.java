package com.acme.staticforge.api.dto;

import java.time.Instant;

/**
 * What compacting the project now with {@code olderThanDays} would do (M29.4.1): a dry run of the compaction, shown by
 * the confirmation dialog. Response of {@code GET /projects/{key}/compaction/estimate}.
 *
 * @param cutoff versions of revisions before this instant are in the window
 * @param versionsInWindow closed versions older than the cutoff
 * @param versionsRemoved how many of them compaction would remove
 * @param assetsTouched assets that would lose at least one version
 * @param referencesRewritten reference rows that would be deleted or re-bounded
 * @param revisionsMarked revisions that would be flagged {@code compacted}
 * @param bytesFreed the serialized size of the removed versions' payloads (media bytes are freed later by the blob
 *     sweep, when nothing else references them)
 */
public record CompactionEstimateView(
        int olderThanDays,
        Instant cutoff,
        long versionsInWindow,
        long versionsRemoved,
        long assetsTouched,
        long referencesRewritten,
        long revisionsMarked,
        long bytesFreed) {}
