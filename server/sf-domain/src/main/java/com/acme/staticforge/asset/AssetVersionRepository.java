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

    /** The open versions (tombstones included) of several assets, asset joined (search indexing, M23.2.1). */
    @Query("SELECT v FROM AssetVersion v JOIN FETCH v.asset WHERE v.assetId IN :assetIds AND v.validToRevision IS NULL")
    List<AssetVersion> findOpenWithAssetByAssetIdIn(@Param("assetIds") java.util.Collection<Long> assetIds);

    /** Ids of a project's current, non-deleted versions in id order: a full search index rebuild pages through them. */
    @Query("""
            SELECT v.id FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.validToRevision IS NULL
              AND v.deleted = false
            ORDER BY v.id
            """)
    List<Long> findCurrentVersionIdsByProject(@Param("projectId") long projectId);

    /**
     * Assets with a version opened in revisions {@code (sinceRevision, untilRevision]}, each with the <em>oldest</em>
     * such revision (search catch-up keeps its stamp below the first revision an asset failed to index in).
     */
    @Query("""
            SELECT new com.acme.staticforge.asset.AssetChange(v.assetId, MIN(v.validFromRevision))
            FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.validFromRevision > :sinceRevision
              AND v.validFromRevision <= :untilRevision
            GROUP BY v.assetId
            """)
    List<AssetChange> findFirstChangesBetween(
            @Param("projectId") long projectId,
            @Param("sinceRevision") long sinceRevision,
            @Param("untilRevision") long untilRevision);

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

    /**
     * The non-deleted versions of {@code type} valid at revision {@code R} across a project, asset joined: what a
     * time-travel tree or list shows, including what was deleted after {@code R} and excluding what was created later.
     */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset a
            WHERE a.projectId = :projectId
              AND a.assetType = :type
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
              AND v.deleted = false
            """)
    List<AssetVersion> findValidAtByProjectAndType(
            @Param("projectId") Long projectId, @Param("type") AssetType type, @Param("revision") long revision);

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

    /**
     * Every open version of the given asset types in a project, tombstones included, asset joined: the drafts a bulk
     * release status evaluates (M27.1.1).
     */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset a
            WHERE a.projectId = :projectId
              AND a.assetType IN :types
              AND v.validToRevision IS NULL
            """)
    List<AssetVersion> findOpenWithAssetByProjectAndTypeIn(
            @Param("projectId") Long projectId, @Param("types") java.util.Collection<AssetType> types);

    /**
     * The candidates of the Changes view (M27.1.3): open versions of the given types that may have unreleased changes
     * in some locale. A live draft is a candidate unless every one of its {@code keys} locale keys has an open pointer
     * at exactly this version and uid — the only state that is certainly {@code PUBLISHED} without projecting. Media
     * counts one key ({@code ""}) unless it is localized (M27.3.1); a localized media asset's pointers at its draft
     * are per locale, so an open per-locale pointer at the draft tells the query to count every locale key — the flag
     * itself lives in the JSON payload, which the query does not read. A localized draft without any pointer at it is
     * a candidate either way. A tombstone is a candidate while any pointer is still open (deletion pending). The
     * status service then decides per locale, so a candidate may still turn out published (a draft edited back to the
     * released content).
     */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset a
            WHERE a.projectId = :projectId
              AND a.assetType IN :types
              AND v.validToRevision IS NULL
              AND (
                   (v.deleted = false AND
                     (SELECT COUNT(r) FROM com.acme.staticforge.release.AssetRelease r
                      WHERE r.assetId = v.assetId AND r.validToRevision IS NULL
                        AND r.releasedVersionId = v.id AND r.releasedUid = a.uid)
                     < CASE WHEN a.assetType = com.acme.staticforge.asset.AssetType.MEDIA AND NOT EXISTS
                              (SELECT r3.id FROM com.acme.staticforge.release.AssetRelease r3
                               WHERE r3.assetId = v.assetId AND r3.validToRevision IS NULL
                                 AND r3.releasedVersionId = v.id AND r3.localeKey <> '')
                            THEN 1 ELSE :keys END)
                OR (v.deleted = true AND EXISTS
                     (SELECT r2.id FROM com.acme.staticforge.release.AssetRelease r2
                      WHERE r2.assetId = v.assetId AND r2.validToRevision IS NULL))
              )
            """)
    List<AssetVersion> findChangeCandidates(
            @Param("projectId") Long projectId,
            @Param("types") java.util.Collection<AssetType> types,
            @Param("keys") long keys);

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

    /** The non-deleted direct children of a folder at revision {@code R} (M27.2.3: navigation of a revision preview). */
    @Query("""
            SELECT v FROM AssetVersion v
            WHERE v.folderId = :folderId
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
              AND v.deleted = false
            """)
    List<AssetVersion> findChildrenValidAt(@Param("folderId") Long folderId, @Param("revision") long revision);

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

    /**
     * Current, non-deleted record sets of a dataset (M25), asset joined. Like a record, a set mirrors its
     * {@code datasetRef} into {@code template_asset_id}; the {@code asset_type} filter keeps records out.
     */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD_SET
              AND v.templateAssetId = :datasetAssetId
              AND v.validToRevision IS NULL
              AND v.deleted = false
            """)
    List<AssetVersion> findCurrentSetsOfDataset(
            @Param("projectId") long projectId, @Param("datasetAssetId") long datasetAssetId);

    /** Record sets of a dataset that are live (not deleted) at revision {@code R} (M25), asset joined. */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD_SET
              AND v.templateAssetId = :datasetAssetId
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
              AND v.deleted = false
            """)
    List<AssetVersion> findSetsOfDatasetAt(
            @Param("projectId") long projectId,
            @Param("datasetAssetId") long datasetAssetId,
            @Param("revision") long revision);

    /** How many current, non-deleted record sets a dataset has (M25). */
    @Query("""
            SELECT COUNT(v) FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD_SET
              AND v.templateAssetId = :datasetAssetId
              AND v.validToRevision IS NULL
              AND v.deleted = false
            """)
    long countCurrentSetsOfDataset(@Param("projectId") long projectId, @Param("datasetAssetId") long datasetAssetId);

    /** How many current, non-deleted direct children of {@code type} the container {@code folderId} holds. */
    @Query("""
            SELECT COUNT(v) FROM AssetVersion v
            WHERE v.folderId = :folderId
              AND v.asset.assetType = :type
              AND v.validToRevision IS NULL
              AND v.deleted = false
            """)
    long countCurrentChildrenOfType(@Param("folderId") long folderId, @Param("type") AssetType type);

    /** The current, non-deleted records of the record set {@code setId} (M25.1.2), asset joined. */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset
            WHERE v.folderId = :setId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD
              AND v.validToRevision IS NULL
              AND v.deleted = false
            """)
    List<AssetVersion> findCurrentRecordsOfSet(@Param("setId") long setId);

    /**
     * The non-deleted records that sat in the record set {@code setId} at revision {@code R} (M25, the set grid's
     * time travel), asset joined: membership and values as of that revision.
     */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset
            WHERE v.folderId = :setId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
              AND v.deleted = false
            """)
    List<AssetVersion> findRecordsOfSetAt(@Param("setId") long setId, @Param("revision") long revision);

    /** How many direct children of {@code type} the container {@code folderId} held, live, at revision {@code R}. */
    @Query("""
            SELECT COUNT(v) FROM AssetVersion v
            WHERE v.folderId = :folderId
              AND v.asset.assetType = :type
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
              AND v.deleted = false
            """)
    long countChildrenOfTypeAt(
            @Param("folderId") long folderId, @Param("type") AssetType type, @Param("revision") long revision);

    /**
     * The live record count of every record set of a project (M25) in one grouped query: sets without a
     * live record are absent. Keeps the Content tree and the set listing free of per-set counts.
     */
    @Query("""
            SELECT new com.acme.staticforge.asset.ChildCount(v.folderId, COUNT(v))
            FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD
              AND v.validToRevision IS NULL
              AND v.deleted = false
            GROUP BY v.folderId
            """)
    List<ChildCount> countCurrentRecordsPerSet(@Param("projectId") long projectId);

    /** {@link #countCurrentRecordsPerSet} as of revision {@code R}: the records live then, per set. */
    @Query("""
            SELECT new com.acme.staticforge.asset.ChildCount(v.folderId, COUNT(v))
            FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.asset.assetType = com.acme.staticforge.asset.AssetType.RECORD
              AND v.validFromRevision <= :revision
              AND (v.validToRevision IS NULL OR v.validToRevision > :revision)
              AND v.deleted = false
            GROUP BY v.folderId
            """)
    List<ChildCount> countRecordsPerSetAt(@Param("projectId") long projectId, @Param("revision") long revision);

    /**
     * Live versions of {@code folderId}'s direct children that were closed exactly at {@code revision}, asset
     * joined: what a cascading delete in that revision took with it (M25 record set restore).
     */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset
            WHERE v.folderId = :folderId
              AND v.validToRevision = :revision
              AND v.deleted = false
            """)
    List<AssetVersion> findLiveChildVersionsClosedAt(@Param("folderId") long folderId, @Param("revision") long revision);

    /** Current, non-deleted pages whose page template is one of {@code templateAssetIds} (M20), by uid. */
    @Query("""
            SELECT v FROM AssetVersion v JOIN FETCH v.asset a
            WHERE a.projectId = :projectId
              AND a.assetType = com.acme.staticforge.asset.AssetType.PAGE
              AND v.templateAssetId IN :templateAssetIds
              AND v.validToRevision IS NULL
              AND v.deleted = false
            ORDER BY a.uid
            """)
    List<AssetVersion> findCurrentPagesOfTemplates(
            @Param("projectId") long projectId, @Param("templateAssetIds") java.util.Collection<Long> templateAssetIds);

    /**
     * Assets with a version opened in revisions {@code (sinceRevision, untilRevision]} (deletions included), each with
     * the newest such revision: the changes an incremental build pinned to {@code untilRevision} has to render.
     */
    @Query("""
            SELECT new com.acme.staticforge.asset.AssetChange(v.assetId, MAX(v.validFromRevision))
            FROM AssetVersion v
            WHERE v.asset.projectId = :projectId
              AND v.validFromRevision > :sinceRevision
              AND v.validFromRevision <= :untilRevision
            GROUP BY v.assetId
            """)
    List<AssetChange> findChangesBetween(
            @Param("projectId") long projectId,
            @Param("sinceRevision") long sinceRevision,
            @Param("untilRevision") long untilRevision);
}
