package com.acme.staticforge.urlregistry;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * {@link UrlRegistryEntry} persistence (`M8.2.1`, every target since M32.1): the single-tuple lookup, the bulk load a
 * build reads its area through, the URL-holder lookup behind "one URL, one target", the filtered listing of the
 * settings UI and the scoped deletes of resets and cleanups.
 */
public interface UrlRegistryRepository extends JpaRepository<UrlRegistryEntry, Long> {

    @Query("""
            SELECT e FROM UrlRegistryEntry e
            WHERE e.projectId = :projectId AND e.channelKey = :channelKey AND e.area = :area AND e.localeKey = :localeKey
              AND e.targetType = :targetType AND e.targetUuid = :targetUuid AND e.variantKey = :variantKey
              AND e.pageNumber = :pageNumber
            """)
    Optional<UrlRegistryEntry> findTuple(
            @Param("projectId") long projectId,
            @Param("channelKey") String channelKey,
            @Param("area") UrlArea area,
            @Param("localeKey") String localeKey,
            @Param("targetType") UrlTargetType targetType,
            @Param("targetUuid") UUID targetUuid,
            @Param("variantKey") String variantKey,
            @Param("pageNumber") int pageNumber);

    /** The row holding {@code url} in one channel, area and language, if any ({@code uq_url_registry_url}). */
    Optional<UrlRegistryEntry> findByProjectIdAndChannelKeyAndAreaAndLocaleKeyAndUrl(
            long projectId, String channelKey, UrlArea area, String localeKey, String url);

    /** Every row of one area — what a build or a preview reads the registry through. */
    List<UrlRegistryEntry> findByProjectIdAndArea(long projectId, UrlArea area);

    /** Every row of one target, both areas. */
    List<UrlRegistryEntry> findByProjectIdAndTargetUuid(long projectId, UUID targetUuid);

    /** Every row of a project (export, M32.6). */
    List<UrlRegistryEntry> findByProjectIdAndAreaOrderByIdAsc(long projectId, UrlArea area);

    /**
     * Inserts a row (computed, or an imported override) unless its tuple or its URL is already taken, atomically at the database
     * level ({@code uq_url_registry_tuple}, {@code uq_url_registry_url}). Unlike {@code save} + catching the unique
     * violation, losing a race here raises no exception, so it neither poisons the persistence context nor marks the
     * transaction rollback-only. Supported by PostgreSQL and by H2 in PostgreSQL mode (dev/test).
     *
     * @return 1 if this call inserted the row, 0 if the tuple or the URL was taken
     */
    @Modifying
    @Query(value = """
            INSERT INTO url_registry_entry
                (project_id, channel_key, area, locale_key, target_type, target_uuid, variant_key, page_number, url,
                 assigned_at, assigned_revision, overridden)
            VALUES (:projectId, :channelKey, :area, :localeKey, :targetType, :targetUuid, :variantKey, :pageNumber, :url,
                    :assignedAt, :assignedRevision, :overridden)
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(
            @Param("projectId") long projectId,
            @Param("channelKey") String channelKey,
            @Param("area") String area,
            @Param("localeKey") String localeKey,
            @Param("targetType") String targetType,
            @Param("targetUuid") UUID targetUuid,
            @Param("variantKey") String variantKey,
            @Param("pageNumber") int pageNumber,
            @Param("url") String url,
            @Param("assignedAt") Instant assignedAt,
            @Param("assignedRevision") long assignedRevision,
            @Param("overridden") boolean overridden);

    /**
     * Filtered listing for the settings UI; every filter is optional ({@code null} = unfiltered). {@code targetUuids}
     * narrows to the rows of those targets (a search by asset name resolves names to uuids first); pass
     * {@code anyTarget = true} to ignore it.
     */
    @Query("""
            SELECT e FROM UrlRegistryEntry e
            WHERE e.projectId = :projectId
              AND (:channelKey IS NULL OR e.channelKey = :channelKey)
              AND (:area IS NULL OR e.area = :area)
              AND (:targetType IS NULL OR e.targetType = :targetType)
              AND (:localeKey IS NULL OR e.localeKey = :localeKey)
              AND (:targetUuid IS NULL OR e.targetUuid = :targetUuid)
              AND (:urlLike IS NULL OR LOWER(e.url) LIKE :urlLike OR (:anyTarget = FALSE AND e.targetUuid IN :targetUuids))
            """)
    Page<UrlRegistryEntry> search(
            @Param("projectId") long projectId,
            @Param("channelKey") String channelKey,
            @Param("area") UrlArea area,
            @Param("targetType") UrlTargetType targetType,
            @Param("localeKey") String localeKey,
            @Param("targetUuid") UUID targetUuid,
            @Param("urlLike") String urlLike,
            @Param("anyTarget") boolean anyTarget,
            @Param("targetUuids") Collection<UUID> targetUuids,
            Pageable pageable);

    /** Reset scope: every entry for one channel in a project (both areas). */
    void deleteByProjectIdAndChannelKey(long projectId, String channelKey);

    /**
     * Every computed (non-overridden) entry for one channel, both areas — used when the channel's output settings
     * change ({@code ChannelServiceImpl.update}); manual overrides are kept.
     */
    void deleteByProjectIdAndChannelKeyAndOverriddenFalse(long projectId, String channelKey);

    /** Reset scope: every entry for a project (all channels, both areas). */
    void deleteByProjectId(long projectId);

    /** Reset scope: every entry in one area for a project (all channels). */
    void deleteByProjectIdAndArea(long projectId, UrlArea area);

    /** Reset scope {@code ASSET}: every row of one target, both areas. */
    void deleteByProjectIdAndTargetUuid(long projectId, UUID targetUuid);

    /** Reset scope {@code ASSET} in one area. */
    void deleteByProjectIdAndTargetUuidAndArea(long projectId, UUID targetUuid, UrlArea area);

    /** Cleanup of a removed target: its computed rows in one area; overrides stay. */
    void deleteByProjectIdAndTargetUuidAndAreaAndOverriddenFalse(long projectId, UUID targetUuid, UrlArea area);
}
