package com.acme.staticforge.asset.media;

import com.acme.staticforge.asset.AssetVersion;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Media-scoped reads over {@link AssetVersion}. Kept separate from the generic
 * {@code asset} repositories so the MIME-family filter used by the media library
 * ({@code ?mimeType=image/*}) lives beside the media service rather than widening the
 * generic asset query. Read-only — writes flow through {@link MediaService}.
 */
public interface MediaVersionRepository extends JpaRepository<AssetVersion, Long> {

    /**
     * Current (open, non-deleted) media versions within a project, filtered by MIME prefix,
     * folder-path prefix and a display-name substring. All pattern parameters are already
     * {@code !}-escaped by the caller.
     */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.MEDIA
              AND v.validToRevision IS NULL
              AND v.deleted = false
              AND (:mimePattern IS NULL OR v.mimeType LIKE :mimePattern ESCAPE '!')
              AND (:q IS NULL OR LOWER(v.displayName) LIKE LOWER(CONCAT('%', :q, '%')) ESCAPE '!')
              AND (:folderPattern IS NULL OR v.folderPath LIKE :folderPattern ESCAPE '!')
            """)
    Page<AssetVersion> searchMedia(
            @Param("projectId") Long projectId,
            @Param("mimePattern") String mimePattern,
            @Param("q") String q,
            @Param("folderPattern") String folderPattern,
            Pageable pageable);

    Optional<AssetVersion> findByAssetIdAndValidToRevisionIsNull(Long assetId);

    /**
     * Media versions of every project with an id above {@code afterId}, in id order (keyset pages for the
     * {@code media-variant-backfill} job, M29.3.2): not deleted, and open unless {@code includeClosed}.
     */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.asset.assetType = com.acme.staticforge.asset.AssetType.MEDIA
              AND v.deleted = false
              AND (:includeClosed = true OR v.validToRevision IS NULL)
              AND v.id > :afterId
            ORDER BY v.id
            """)
    List<AssetVersion> findMediaAfter(
            @Param("afterId") long afterId, @Param("includeClosed") boolean includeClosed, Pageable pageable);

    /**
     * Every media version of every project with an id above {@code afterId}, in id order — closed and deleted ones
     * included (keyset pages for the blob sweep's mark, M29.2.3).
     */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.asset.assetType = com.acme.staticforge.asset.AssetType.MEDIA
              AND v.id > :afterId
            ORDER BY v.id
            """)
    List<AssetVersion> findEveryMediaVersionAfter(@Param("afterId") long afterId, Pageable pageable);
}
