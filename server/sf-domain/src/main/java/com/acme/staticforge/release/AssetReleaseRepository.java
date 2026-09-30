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
     * The reference edges of the released versions valid at revision {@code R} that are no longer their asset's
     * version at {@code R} (M27.2.2): what a released page still depends on although its draft dropped the reference.
     * An edge belongs to a version when it is valid at the revision the version was written in. Released versions
     * that are the drafts at {@code R} are left out — their edges are the ones valid at {@code R}.
     */
    @Query("""
            SELECT DISTINCT new com.acme.staticforge.asset.ReferenceRow(e.fromAssetId, e.toAssetId, e.kind, e.sourcePath)
            FROM AssetRelease r, AssetVersion v, AssetReference e
            WHERE r.projectId = :projectId
              AND r.validFromRevision <= :revision
              AND (r.validToRevision IS NULL OR r.validToRevision > :revision)
              AND v.id = r.releasedVersionId
              AND v.validToRevision IS NOT NULL
              AND v.validToRevision <= :revision
              AND e.fromAssetId = r.assetId
              AND e.validFromRevision <= v.validFromRevision
              AND (e.validToRevision IS NULL OR e.validToRevision > v.validFromRevision)
            """)
    List<com.acme.staticforge.asset.ReferenceRow> findReleasedEdgeRowsValidAt(
            @Param("projectId") long projectId, @Param("revision") long revision);

    /**
     * The released versions valid at revision {@code R} that are valid at no revision themselves ({@code validFrom =
     * validTo}), asset joined: a released version an import wrote next to its draft (M27.5.1). Their reference edges
     * are not in {@code asset_reference} — the import revision's edge set is the draft's — so a reader that needs a
     * released version's edges extracts them from these payloads.
     */
    @Query("""
            SELECT DISTINCT v FROM AssetVersion v JOIN FETCH v.asset, AssetRelease r
            WHERE r.projectId = :projectId
              AND r.validFromRevision <= :revision
              AND (r.validToRevision IS NULL OR r.validToRevision > :revision)
              AND v.id = r.releasedVersionId
              AND v.validToRevision = v.validFromRevision
            """)
    List<com.acme.staticforge.asset.AssetVersion> findUnmaterializedReleasedVersionsValidAt(
            @Param("projectId") long projectId, @Param("revision") long revision);

    /**
     * The released children of a folder at revision {@code R} for locale key {@code key} (or the shared {@code ""}
     * key) as {@code [pointer, version, asset]}: the assets whose released version sits in the folder (M27.2.3).
     */
    @Query("""
            SELECT r, v, a FROM AssetRelease r, AssetVersion v, com.acme.staticforge.asset.Asset a
            WHERE r.projectId = :projectId
              AND r.validFromRevision <= :revision
              AND (r.validToRevision IS NULL OR r.validToRevision > :revision)
              AND (r.localeKey = :key OR r.localeKey = '')
              AND v.id = r.releasedVersionId
              AND v.folderId = :folderId
              AND v.deleted = false
              AND a.id = r.assetId
            """)
    List<Object[]> findReleasedChildrenAt(
            @Param("projectId") long projectId,
            @Param("folderId") long folderId,
            @Param("revision") long revision,
            @Param("key") String key);

    /** The released records of a dataset at revision {@code R} for {@code key}, as {@code [pointer, version, asset]}. */
    @Query("""
            SELECT r, v, a FROM AssetRelease r, AssetVersion v, com.acme.staticforge.asset.Asset a
            WHERE r.projectId = :projectId
              AND r.validFromRevision <= :revision
              AND (r.validToRevision IS NULL OR r.validToRevision > :revision)
              AND (r.localeKey = :key OR r.localeKey = '')
              AND v.id = r.releasedVersionId
              AND v.templateAssetId = :datasetAssetId
              AND v.deleted = false
              AND a.id = r.assetId
              AND a.assetType = com.acme.staticforge.asset.AssetType.RECORD
            """)
    List<Object[]> findReleasedRecordsOfDatasetAt(
            @Param("projectId") long projectId,
            @Param("datasetAssetId") long datasetAssetId,
            @Param("revision") long revision,
            @Param("key") String key);

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

    /** {@link #findEverReleasedKeys} as of revision {@code R}: the pairs released in revision {@code R} or before. */
    @Query("""
            SELECT DISTINCT new com.acme.staticforge.release.ReleasedKey(r.assetId, r.localeKey)
            FROM AssetRelease r
            WHERE r.assetId IN :assetIds
              AND r.validFromRevision <= :revision
            """)
    List<ReleasedKey> findEverReleasedKeysUpTo(
            @Param("assetIds") Collection<Long> assetIds, @Param("revision") long revision);

    /** Every pointer of a project, open or closed — the invariant suite and diagnostics read the full history. */
    List<AssetRelease> findByProjectIdOrderByAssetIdAscLocaleKeyAscValidFromRevisionAsc(Long projectId);
}
