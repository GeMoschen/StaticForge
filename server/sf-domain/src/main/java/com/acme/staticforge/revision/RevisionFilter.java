package com.acme.staticforge.revision;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/**
 * The optional criteria of a revision listing; a {@code null} (or empty) component does not filter.
 *
 * @param since only revisions strictly newer than this revision id
 * @param userId only revisions by this author
 * @param assetUuid only revisions whose summary touched this asset
 * @param changeTypes only revisions of one of these change types
 * @param from only revisions created at or after this instant (inclusive)
 * @param to only revisions created before this instant (exclusive)
 * @param q case-insensitive substring of the revision comment or of a touched item's name
 */
public record RevisionFilter(
        Long since, Long userId, UUID assetUuid, Set<ChangeType> changeTypes, Instant from, Instant to, String q) {

    /** The filter of the incremental listing: no change type, date range or search text. */
    public static RevisionFilter of(Long since, Long userId, UUID assetUuid) {
        return new RevisionFilter(since, userId, assetUuid, null, null, null, null);
    }
}
