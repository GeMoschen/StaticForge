package com.acme.staticforge.asset;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Materialized reference edges (spec §5.4). Readers query edges <em>valid at a revision</em>
 * ({@code valid_from_revision <= R AND (valid_to_revision IS NULL OR valid_to_revision > R)}) or
 * the open edges; a row's interval follows the version of its {@code from} asset.
 */
public interface AssetReferenceRepository extends JpaRepository<AssetReference, Long> {

    List<AssetReference> findByToAssetId(Long toAssetId);

    List<AssetReference> findByFromAssetId(Long fromAssetId);

    /** The open (current) outgoing edge set of an asset. */
    List<AssetReference> findByFromAssetIdAndValidToRevisionIsNull(Long fromAssetId);

    /** The open outgoing edges of several assets (M27.1.4: a release plan's dependency walk, one query per layer). */
    List<AssetReference> findByFromAssetIdInAndValidToRevisionIsNull(java.util.Collection<Long> fromAssetIds);

    /** Outgoing edges closed at exactly {@code validToRevision}. */
    List<AssetReference> findByFromAssetIdAndValidToRevision(Long fromAssetId, Long validToRevision);

    /** Incoming edges of an asset valid at revision {@code R}. */
    @Query("""
            SELECT r FROM AssetReference r
            WHERE r.toAssetId = :toAssetId
              AND r.validFromRevision <= :revision
              AND (r.validToRevision IS NULL OR r.validToRevision > :revision)
            """)
    List<AssetReference> findIncomingValidAt(@Param("toAssetId") Long toAssetId, @Param("revision") long revision);

    /** Outgoing edges of an asset valid at revision {@code R}. */
    @Query("""
            SELECT r FROM AssetReference r
            WHERE r.fromAssetId = :fromAssetId
              AND r.validFromRevision <= :revision
              AND (r.validToRevision IS NULL OR r.validToRevision > :revision)
            """)
    List<AssetReference> findOutgoingValidAt(@Param("fromAssetId") Long fromAssetId, @Param("revision") long revision);

    /** How many open (current) edges point at each of the given assets, as `[toAssetId, count]` rows (assets nothing points at have none). */
    @Query("SELECT r.toAssetId, COUNT(r) FROM AssetReference r WHERE r.toAssetId IN :toAssetIds AND r.validToRevision IS NULL GROUP BY r.toAssetId")
    List<Object[]> countIncomingOpen(@Param("toAssetIds") java.util.Collection<Long> toAssetIds);

    /** Incoming open (current-state) edges of an asset. */
    @Query("SELECT r FROM AssetReference r WHERE r.toAssetId = :toAssetId AND r.validToRevision IS NULL")
    List<AssetReference> findIncomingOpen(@Param("toAssetId") Long toAssetId);

    /**
     * Every edge of a project valid at revision {@code R} with its kind and source path: one query, for in-memory
     * reverse indexes that explain the edges they follow (M22.1.1).
     */
    @Query("""
            SELECT new com.acme.staticforge.asset.ReferenceRow(r.fromAssetId, r.toAssetId, r.kind, r.sourcePath)
            FROM AssetReference r, Asset a
            WHERE a.id = r.fromAssetId
              AND a.projectId = :projectId
              AND r.validFromRevision <= :revision
              AND (r.validToRevision IS NULL OR r.validToRevision > :revision)
            """)
    List<ReferenceRow> findRowsValidAtByProject(@Param("projectId") long projectId, @Param("revision") long revision);
}
