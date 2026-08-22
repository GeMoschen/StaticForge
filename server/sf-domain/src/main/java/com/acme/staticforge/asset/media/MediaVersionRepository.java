package com.acme.staticforge.asset.media;

import com.acme.staticforge.asset.AssetVersion;
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
}
