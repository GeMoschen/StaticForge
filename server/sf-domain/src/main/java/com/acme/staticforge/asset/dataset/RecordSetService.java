package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.dataset.RecordService.RecordListQuery;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.query.RecordSetQuery;
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
 *
 * <p>The stored query (M25.1.2) is validated on every save against the dataset's schema
 * ({@link com.acme.staticforge.template.query.RecordSetQueries}): an invalid query is {@code 422} with
 * {@code diagnostics} ({@code SF-TPL-0140..0142}, each naming its query part and position) and nothing is
 * written. A schema change can still leave a stored query invalid later; reads report that as
 * {@link RecordSetView#queryValid()}.
 */
public interface RecordSetService {

    /**
     * Creates a set of a live dataset in {@code folderUuid} ({@code null}: the Content store root).
     *
     * @throws com.acme.staticforge.common.SfException {@code 404} for an unknown or deleted dataset,
     *     {@code 422 SF-DOM-0104} for a parent that is not a Content folder, {@code 422} for a malformed,
     *     reserved or taken {@code uid}, {@code 422} with {@code diagnostics} for an invalid query
     */
    RecordSetView create(CreateRecordSetCommand cmd, RevisionContext ctx);

    /**
     * Renames a set and replaces its query; the dataset is kept. Saving a valid query is what clears a set
     * a schema change left broken.
     *
     * @throws com.acme.staticforge.common.SfException {@code 409} when the set changed since
     *     {@code expectedRevision}, {@code 422} with {@code diagnostics} for an invalid query
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

    /**
     * Checks a draft query for the set without saving it: its diagnostics against the set's dataset and how
     * many of the set's live records it would match and show (default content language).
     */
    RecordSetQueryPreview previewQuery(long projectId, UUID uuid, RecordSetQuery draft);

    /**
     * One page of the set's live records for the record grid.
     *
     * <p>With {@code applySetQuery} the set's stored query runs first and the request narrows its result
     * (epic decision 5): {@code where} is AND-ed, a {@code sort} re-sorts (without one the set's order is
     * kept) and {@code q} filters display names; a set whose query no longer validates lists nothing.
     * Without it every record of the set is listed, filtered by {@code q}/{@code where} and ordered by
     * {@code sort} (default order {@code _displayName}, {@code _uid}), like the dataset listing.
     * {@code query.folder} is ignored: the set is the scope.
     *
     * <p>Language-dependent values are compared in {@code locale}'s fallback chain — the project's default
     * language when {@code null} or undeclared — the rule a {@code $CMS_FOR} over the set follows for its
     * render language. Rows show the stored values, as in the dataset listing.
     *
     * @throws com.acme.staticforge.common.SfException {@code 400} for an invalid {@code where} (with
     *     {@code column}) or an unknown or unsortable {@code sort} field, {@code 404} for an unknown or
     *     deleted set
     */
    RecordPage listRecords(
            long projectId, UUID uuid, RecordListQuery query, boolean applySetQuery, String locale, int page, int size);
}
