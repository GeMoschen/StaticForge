package com.acme.staticforge.asset;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AssetVersionRepository extends JpaRepository<AssetVersion, Long> {

    Optional<AssetVersion> findByAssetIdAndValidToRevisionIsNull(Long assetId);

    Optional<AssetVersion> findByAssetIdAndValidFromRevisionLessThanEqualAndValidToRevisionIsNull(
            Long assetId, long revision);

    List<AssetVersion> findByAssetIdOrderByValidFromRevisionDesc(Long assetId);

    /** The single version valid at revision {@code R} (inclusive of {@code validFrom}, exclusive of {@code validTo}). */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.assetId = :assetId
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
            """)
    Optional<AssetVersion> findValidAtRevision(@Param("assetId") Long assetId, @Param("revision") long revision);

    /** {@link #findValidAtRevision} for several assets in one query; assets that didn't exist yet are absent. */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.assetId IN :assetIds
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
            """)
    List<AssetVersion> findValidAtRevisionByAssetIdIn(
            @Param("assetIds") java.util.Collection<Long> assetIds, @Param("revision") long revision);

    /** Current (open) versions within a project, filtered by type, folder-path prefix and a display-name substring. */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.validToRevision IS NULL
              AND v.deleted = false
              AND (:type IS NULL OR v.asset.assetType = :type)
              AND (:q IS NULL OR LOWER(v.displayName) LIKE LOWER(CONCAT('%', :q, '%')) ESCAPE '!')
              AND (:folderPattern IS NULL OR v.folderPath LIKE :folderPattern ESCAPE '!')
            """)
    Page<AssetVersion> search(@Param("projectId") Long projectId, @Param("type") AssetType type,
            @Param("q") String q, @Param("folderPattern") String folderPattern, Pageable pageable);

    /** All open, non-deleted versions in a project (used for subtree walks and tree building). */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.validToRevision IS NULL
              AND v.deleted = false
            """)
    List<AssetVersion> findCurrentByProject(@Param("projectId") Long projectId);

    /** Current, non-deleted versions of a given type within a project. */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = :type
              AND v.validToRevision IS NULL
              AND v.deleted = false
            """)
    List<AssetVersion> findCurrentByProjectAndType(@Param("projectId") Long projectId, @Param("type") AssetType type);

    /** Every open version in a project, soft-deleted tombstones included. */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.validToRevision IS NULL
            """)
    List<AssetVersion> findOpenByProject(@Param("projectId") Long projectId);

    /** Every version (deleted included) valid at revision {@code R} across a project. */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
            """)
    List<AssetVersion> findValidAtRevisionByProject(@Param("projectId") Long projectId, @Param("revision") long revision);

    boolean existsByFolderIdAndValidToRevisionIsNull(Long folderId);

    /** The current, non-deleted, direct children of a folder (by parent {@code folderId}). */
    List<AssetVersion> findByFolderIdAndValidToRevisionIsNullAndDeletedFalse(Long folderId);

    /** Eager snapshot: every version (deleted included) valid at revision {@code R}, asset joined. */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset
            WHERE v.asset.projectId = :projectId
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
            """)
    List<AssetVersion> findSnapshot(@Param("projectId") Long projectId, @Param("revision") long revision);

    /** Eager snapshot of the current (open, non-deleted) versions in a project, asset joined. */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset
            WHERE v.asset.projectId = :projectId
              AND v.validToRevision IS NULL
              AND v.deleted = false
            """)
    List<AssetVersion> findCurrentSnapshot(@Param("projectId") Long projectId);

    /**
     * Current, non-deleted records of a dataset (M19.1.1), asset joined. The record → dataset link is
     * {@code template_asset_id} (mirrored from {@code payload.datasetRef}), so this is a column query.
     */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD
              AND v.templateAssetId = :datasetAssetId
              AND v.validToRevision IS NULL
              AND v.deleted = false
            """)
    List<AssetVersion> findCurrentRecordsOfDataset(
            @Param("projectId") long projectId, @Param("datasetAssetId") long datasetAssetId);

    /**
     * Current, non-deleted records of a dataset whose display name contains {@code q}
     * (case-insensitive, {@code null} for any) and whose folder path matches {@code folderPattern}
     * ({@code LIKE} with {@code !} escapes, {@code null} for any) — the SQL half of the record listing.
     */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD
              AND v.templateAssetId = :datasetAssetId
              AND v.validToRevision IS NULL
              AND v.deleted = false
              AND (:q IS NULL OR LOWER(v.displayName) LIKE LOWER(CONCAT('%', :q, '%')) ESCAPE '!')
              AND (:folderPattern IS NULL OR v.folderPath LIKE :folderPattern ESCAPE '!')
            """)
    List<AssetVersion> searchCurrentRecordsOfDataset(
            @Param("projectId") long projectId,
            @Param("datasetAssetId") long datasetAssetId,
            @Param("q") String q,
            @Param("folderPattern") String folderPattern);

    /** Records of a dataset that are live (not deleted) at revision {@code R}, asset joined. */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD
              AND v.templateAssetId = :datasetAssetId
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
              AND v.deleted = false
            """)
    List<AssetVersion> findRecordsOfDatasetAt(
            @Param("projectId") long projectId,
            @Param("datasetAssetId") long datasetAssetId,
            @Param("revision") long revision);

    /** Ids of the current, non-deleted record versions of a dataset (a rename migration walks them in chunks). */
    @Query("""
            SELECT v.id FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD
              AND v.templateAssetId = :datasetAssetId
              AND v.validToRevision IS NULL
              AND v.deleted = false
            ORDER BY v.id
            """)
    List<Long> findCurrentRecordVersionIdsOfDataset(
            @Param("projectId") long projectId, @Param("datasetAssetId") long datasetAssetId);

    /** Versions by id, asset joined. */
    @Query("SELECT v FROM AssetVersion v JOIN FETCH v.asset WHERE v.id IN :ids")
    List<AssetVersion> findWithAssetByIdIn(@Param("ids") java.util.Collection<Long> ids);

    /** How many current, non-deleted records a dataset has. */
    @Query("""
            SELECT COUNT(v) FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD
              AND v.templateAssetId = :datasetAssetId
              AND v.validToRevision IS NULL
              AND v.deleted = false
            """)
    long countCurrentRecordsOfDataset(@Param("projectId") long projectId, @Param("datasetAssetId") long datasetAssetId);

    /** Distinct asset ids with a version opened after {@code sinceRevision} (deletions included). */
    @Query("""
            SELECT DISTINCT v.assetId FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.validFromRevision > :sinceRevision
            """)
    List<Long> findAssetIdsChangedSince(@Param("projectId") Long projectId, @Param("sinceRevision") long sinceRevision);
}
