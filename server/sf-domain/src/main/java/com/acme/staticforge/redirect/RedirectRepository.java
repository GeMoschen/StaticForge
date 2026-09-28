package com.acme.staticforge.redirect;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** {@link RedirectEntry} persistence (M30.4.1). */
public interface RedirectRepository extends JpaRepository<RedirectEntry, Long> {

    Optional<RedirectEntry> findByIdAndProjectId(long id, long projectId);

    Optional<RedirectEntry> findByProjectIdAndChannelKeyAndLocaleKeyAndFromPath(
            long projectId, String channelKey, String localeKey, String fromPath);

    /** Every redirect of the project, in a stable order (the build and the archive read them all). */
    List<RedirectEntry> findByProjectIdOrderByChannelKeyAscLocaleKeyAscFromPathAsc(long projectId);

    /** Every redirect of one channel and locale (the loop check of a manual redirect follows chains there). */
    List<RedirectEntry> findByProjectIdAndChannelKeyAndLocaleKey(long projectId, String channelKey, String localeKey);

    /**
     * One page of the registry, sorted by channel, locale and source path. Every filter is optional ({@code null} for
     * any); {@code q} is a {@code LIKE} needle with {@code !} escapes, matched case-insensitively against the source
     * and the fixed target path.
     */
    @Query(value = """
            SELECT r FROM RedirectEntry r
            WHERE r.projectId = :projectId
              AND (:channel IS NULL OR r.channelKey = :channel)
              AND (:locale IS NULL OR r.localeKey = :locale)
              AND (:kind IS NULL OR r.kind = :kind)
              AND (:q IS NULL
                   OR LOWER(r.fromPath) LIKE LOWER(CONCAT('%', :q, '%')) ESCAPE '!'
                   OR LOWER(r.toPath) LIKE LOWER(CONCAT('%', :q, '%')) ESCAPE '!')
            ORDER BY r.channelKey, r.localeKey, r.fromPath, r.id
            """,
            countQuery = """
            SELECT COUNT(r) FROM RedirectEntry r
            WHERE r.projectId = :projectId
              AND (:channel IS NULL OR r.channelKey = :channel)
              AND (:locale IS NULL OR r.localeKey = :locale)
              AND (:kind IS NULL OR r.kind = :kind)
              AND (:q IS NULL
                   OR LOWER(r.fromPath) LIKE LOWER(CONCAT('%', :q, '%')) ESCAPE '!'
                   OR LOWER(r.toPath) LIKE LOWER(CONCAT('%', :q, '%')) ESCAPE '!')
            """)
    Page<RedirectEntry> search(
            @Param("projectId") long projectId,
            @Param("channel") String channel,
            @Param("locale") String locale,
            @Param("kind") RedirectKind kind,
            @Param("q") String q,
            Pageable pageable);

    /**
     * Re-points the {@code AUTO} redirect of a source path at a page (M30.4.2 detection); a {@code MANUAL} one is left
     * alone. Bypasses the persistence context on purpose: it runs inside a build's report transaction.
     *
     * @return 1 when an {@code AUTO} redirect was re-pointed, else 0
     */
    @Modifying
    @Query(value = """
            UPDATE redirect
               SET to_asset_uuid = :asset, to_page_number = :pageNumber, to_path = NULL, source_run_id = :runId,
                   updated_at = :now, updated_by = NULL, version = version + 1
             WHERE project_id = :projectId AND channel_key = :channel AND locale_key = :locale AND from_path = :fromPath
               AND kind = 'AUTO'
            """, nativeQuery = true)
    int updateAuto(
            @Param("projectId") long projectId,
            @Param("channel") String channel,
            @Param("locale") String locale,
            @Param("fromPath") String fromPath,
            @Param("asset") UUID asset,
            @Param("pageNumber") int pageNumber,
            @Param("runId") long runId,
            @Param("now") Instant now);

    /**
     * Adds an {@code AUTO} redirect unless the source path already redirects ({@code uq_redirect_source}), atomically
     * and without an exception on the conflict — so a manual redirect created concurrently neither fails nor is
     * overwritten. Supported by PostgreSQL and by H2 in PostgreSQL mode.
     *
     * @return 1 when this call inserted the row, 0 when the source path already redirects
     */
    @Modifying
    @Query(value = """
            INSERT INTO redirect
                (project_id, channel_key, locale_key, from_path, to_asset_uuid, to_page_number, to_path, kind,
                 created_at, created_by, source_run_id, updated_at, updated_by, version)
            VALUES (:projectId, :channel, :locale, :fromPath, :asset, :pageNumber, NULL, 'AUTO',
                    :now, NULL, :runId, :now, NULL, 0)
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int insertAutoIfAbsent(
            @Param("projectId") long projectId,
            @Param("channel") String channel,
            @Param("locale") String locale,
            @Param("fromPath") String fromPath,
            @Param("asset") UUID asset,
            @Param("pageNumber") int pageNumber,
            @Param("runId") long runId,
            @Param("now") Instant now);
}
