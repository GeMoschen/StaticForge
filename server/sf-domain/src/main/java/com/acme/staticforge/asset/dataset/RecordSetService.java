package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.revision.RevisionContext;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Record sets (M25): the mandatory parent of every record. A set lives in a Content-store folder, fixes
 * the dataset of its records and stores the query deciding which of them are shown and in which order
 * ({@code payload = {datasetRef, query{where, sort, limit, offset}}}). Sets are editor content: the REST
 * layer requires {@code EDITOR} for writes and {@code VIEWER} for reads.
 *
 * <p>Move, restore (a restored set brings back the records its cascading delete took), uid changes,
 * usages and history are generic ({@link com.acme.staticforge.asset.AssetService}); the containment
 * rules ({@link com.acme.staticforge.asset.folder.RecordSetContainment}) hold on every path.
 */
public interface RecordSetService {

    /**
     * Creates a set of a live dataset in {@code folderUuid} ({@code null}: the Content store root).
     *
     * @throws com.acme.staticforge.common.SfException {@code 404} for an unknown or deleted dataset,
     *     {@code 422 SF-DOM-0104} for a parent that is not a Content folder, {@code 422} for a malformed,
     *     reserved or taken {@code uid}
     */
    RecordSetView create(CreateRecordSetCommand cmd, RevisionContext ctx);

    /**
     * Renames a set and replaces its query; the dataset is kept.
     *
     * @throws com.acme.staticforge.common.SfException {@code 409} when the set changed since
     *     {@code expectedRevision}
     */
    RecordSetView update(UUID uuid, UpdateRecordSetCommand cmd, long expectedRevision, RevisionContext ctx);

    /**
     * Soft-deletes a set with folder semantics (epic decision 7): a set with live records is
     * {@code 409 SF-DOM-0110} with {@code recordCount} unless {@code cascade}, which deletes the set and
     * its records in one revision.
     */
    void delete(UUID uuid, boolean cascade, RevisionContext ctx);

    /**
     * The set as of {@code revision} (current when {@code null}), its record count at that revision.
     * Empty for an asset of another type, or one that did not exist yet; an unknown uuid is {@code 404}.
     */
    Optional<RecordSetView> find(long projectId, UUID uuid, Long revision);

    /** The project's live sets — of one dataset when {@code datasetUuid} is given — by display name. */
    List<RecordSetView> list(long projectId, UUID datasetUuid);
}
