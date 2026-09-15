package com.acme.staticforge.urlregistry;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
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

    /**
     * Inserts a computed (non-overridden) entry unless the tuple already exists, atomically at the
     * database level ({@code uq_url_registry_tuple}). Unlike {@code save} + catching the unique
     * violation, losing a concurrent race here raises no exception, so it neither poisons the
     * persistence context nor marks the transaction rollback-only. Supported by PostgreSQL and by
     * H2 in PostgreSQL mode (dev/test).
     *
     * @return 1 if this call inserted the row, 0 if the tuple already existed
     */
    @Modifying
    @Query(value = """
            INSERT INTO url_registry_entry
                (project_id, channel_key, page_reference_uuid, area, url, assigned_at, assigned_revision, overridden)
            VALUES (:projectId, :channelKey, :pageReferenceUuid, :area, :url, :assignedAt, :assignedRevision, FALSE)
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(
            @Param("projectId") long projectId,
            @Param("channelKey") String channelKey,
            @Param("pageReferenceUuid") UUID pageReferenceUuid,
            @Param("area") String area,
            @Param("url") String url,
            @Param("assignedAt") Instant assignedAt,
            @Param("assignedRevision") long assignedRevision);

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
