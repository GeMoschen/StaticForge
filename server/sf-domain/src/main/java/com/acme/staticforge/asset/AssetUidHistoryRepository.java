package com.acme.staticforge.asset;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AssetUidHistoryRepository extends JpaRepository<AssetUidHistory, Long> {

    /**
     * Assets of a project whose uid changed in revisions {@code (sinceRevision, untilRevision]}, each with the newest
     * such revision. A uid change writes no asset version (M22.4.1), so build planning reads it here.
     */
    @Query("""
            SELECT new com.acme.staticforge.asset.AssetChange(h.assetId, MAX(h.revision))
            FROM AssetUidHistory h, Asset a
            WHERE a.id = h.assetId
              AND a.projectId = :projectId
              AND h.revision > :sinceRevision
              AND h.revision <= :untilRevision
            GROUP BY h.assetId
            """)
    List<AssetChange> findUidChangesBetween(
            @Param("projectId") long projectId,
            @Param("sinceRevision") long sinceRevision,
            @Param("untilRevision") long untilRevision);

    /** The uid changes of a project's assets made after revision {@code R}, oldest first. */
    @Query("""
            SELECT h FROM AssetUidHistory h, Asset a
            WHERE a.id = h.assetId
              AND a.projectId = :projectId
              AND h.revision > :revision
            ORDER BY h.revision ASC, h.id ASC
            """)
    List<AssetUidHistory> findChangedAfter(@Param("projectId") long projectId, @Param("revision") long revision);

    /**
     * The uid the project's assets had at revision {@code R}, by asset id, for the assets whose uid changed since (a
     * uid change writes no asset version, so a version read at {@code R} cannot tell): the first change after
     * {@code R} holds the uid it replaced. Every other asset still has its current uid.
     */
    default Map<Long, String> uidsAt(long projectId, long revision) {
        Map<Long, String> uids = new HashMap<>();
        for (AssetUidHistory change : findChangedAfter(projectId, revision)) {
            uids.putIfAbsent(change.getAssetId(), change.getOldUid());
        }
        return uids;
    }
}
