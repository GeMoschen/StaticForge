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

    /** Distinct asset ids with a version opened after {@code sinceRevision} (deletions included). */
    @Query("""
            SELECT DISTINCT v.assetId FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.validFromRevision > :sinceRevision
            """)
    List<Long> findAssetIdsChangedSince(@Param("projectId") Long projectId, @Param("sinceRevision") long sinceRevision);
}
