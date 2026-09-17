package com.acme.staticforge.asset;

import java.util.List;
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
}
