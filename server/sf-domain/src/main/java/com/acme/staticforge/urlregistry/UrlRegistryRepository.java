package com.acme.staticforge.urlregistry;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * {@link UrlRegistryEntry} persistence (`M8.2.1`). Supports the single-tuple lookup
 * {@code M8.2.2}'s assignment/resolution logic will use, the filtered/paginated listing the
 * settings UI (`M8.2.5`) needs, and the scoped deletes the reset operation (`M8.2.2`) and the
 * {@code PageReference} cascade-delete hook (see {@code AssetServiceImpl#softDelete}) use.
 */
public interface UrlRegistryRepository extends JpaRepository<UrlRegistryEntry, Long> {

    Optional<UrlRegistryEntry> findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(
            long projectId, String channelKey, UUID pageReferenceUuid, UrlArea area);

    /** Paginated, filterable listing for the settings UI: {@code channelKey}/{@code area} are optional. */
    @Query("""
            SELECT e FROM UrlRegistryEntry e
            WHERE e.projectId = :projectId
              AND (:channelKey IS NULL OR e.channelKey = :channelKey)
              AND (:area IS NULL OR e.area = :area)
            """)
    Page<UrlRegistryEntry> search(
            @Param("projectId") long projectId,
            @Param("channelKey") String channelKey,
            @Param("area") UrlArea area,
            Pageable pageable);

    /** Reset scope: a single entry — {@code JpaRepository.deleteById} covers this directly. */

    /** Reset scope: every entry for one channel in a project (both areas). */
    void deleteByProjectIdAndChannelKey(long projectId, String channelKey);

    /** Reset scope: every entry for a project (all channels, both areas). */
    void deleteByProjectId(long projectId);

    /** Reset scope: every entry in one area for a project (all channels), added for {@code M8.2.2}. */
    void deleteByProjectIdAndArea(long projectId, UrlArea area);

    /** Cascade-delete hook for {@code PageReference} deletion — both areas, every channel. */
    void deleteByPageReferenceUuid(UUID pageReferenceUuid);
}
