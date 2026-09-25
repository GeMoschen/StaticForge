package com.acme.staticforge.release;

import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Release pointers (M27.1.1). Readers mirror {@link com.acme.staticforge.asset.AssetVersionRepository}: the open rows
 * (current release state) or the rows <em>valid at revision R</em> ({@code validFrom <= R AND (validTo IS NULL OR
 * validTo > R)}), which is what a build or a time-travel read at R sees.
 */
public interface AssetReleaseRepository extends JpaRepository<AssetRelease, Long> {

    /** The open pointers of one asset, one per released locale key. */
    List<AssetRelease> findByAssetIdAndValidToRevisionIsNull(Long assetId);

    /** The open pointers of several assets. */
    List<AssetRelease> findByAssetIdInAndValidToRevisionIsNull(Collection<Long> assetIds);

    /** Every open pointer of a project: its current release state. */
    List<AssetRelease> findByProjectIdAndValidToRevisionIsNull(Long projectId);

    /** Every pointer of a project valid at revision {@code R}: the release state a build at R renders. */
    @Query("""
            SELECT r FROM AssetRelease r
            WHERE r.projectId = :projectId
              AND r.validFromRevision <= :revision
              AND (r.validToRevision IS NULL OR r.validToRevision > :revision)
            """)
    List<AssetRelease> findValidAtByProject(@Param("projectId") long projectId, @Param("revision") long revision);

    /** The pointers of several assets valid at revision {@code R}. */
    @Query("""
            SELECT r FROM AssetRelease r
            WHERE r.assetId IN :assetIds
              AND r.validFromRevision <= :revision
              AND (r.validToRevision IS NULL OR r.validToRevision > :revision)
            """)
    List<AssetRelease> findValidAtByAssetIdIn(
            @Param("assetIds") Collection<Long> assetIds, @Param("revision") long revision);

    /**
     * The (asset, locale key) pairs of the given assets that were ever released, open or closed: what tells
     * {@link ReleaseStatus#UNPUBLISHED} apart from {@link ReleaseStatus#NEW}.
     */
    @Query("""
            SELECT DISTINCT new com.acme.staticforge.release.ReleasedKey(r.assetId, r.localeKey)
            FROM AssetRelease r
            WHERE r.assetId IN :assetIds
            """)
    List<ReleasedKey> findEverReleasedKeys(@Param("assetIds") Collection<Long> assetIds);

    /** Every pointer of a project, open or closed — the invariant suite and diagnostics read the full history. */
    List<AssetRelease> findByProjectIdOrderByAssetIdAscLocaleKeyAscValidFromRevisionAsc(Long projectId);
}
