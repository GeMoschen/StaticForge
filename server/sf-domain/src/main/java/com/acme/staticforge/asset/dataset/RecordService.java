package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.query.SortKey;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Dataset records (M19.1.2): one asset per entry, {@code payload = {datasetRef, content}}, always inside a
 * record set of its dataset (M25). The REST layer requires {@code EDITOR} for writes and {@code VIEWER} for
 * reads.
 *
 * <p>Content is validated against the dataset's schema with page semantics (§10.5): a structural
 * finding (wrong value shape) rejects the save with {@code 422} and {@code issues}; a completeness
 * finding (an empty required field) saves and is returned with the result.
 *
 * <p>Delete, restore, move, uid changes, usages and history are generic
 * ({@link com.acme.staticforge.asset.AssetService}), under the record set containment rules: a record
 * moves only between sets of its dataset, and its dataset never changes after create (moving an entry to
 * another dataset is create + delete).
 */
public interface RecordService {

    /**
     * Adds a record to the record set {@code recordSetUuid}; the set's dataset is the record's. Its uid is
     * derived from its uuid (hex digits, {@code _} for the dashes) and never changes; its display name is the
     * dataset's title editor value when that is set, else the uuid.
     *
     * @throws com.acme.staticforge.common.SfException {@code 422 SF-DOM-0104} without a set, or when the
     *     uuid names a folder or a deleted set; {@code 404} for an unknown uuid or a deleted dataset
     */
    RecordWriteResult create(CreateRecordCommand cmd, RevisionContext ctx);

    /**
     * Replaces a record's content. With a title editor value set the display name follows it; otherwise it
     * stays as it is. The uid never changes.
     */
    RecordWriteResult update(UUID uuid, JsonNode content, long expectedRevision, RevisionContext ctx);

    /**
     * The findings a record's editor shows for its values {@code payload} ({@code {datasetRef, content}}): the
     * {@code edit} outcome of its dataset's built-ins and rules (M33.4). Empty when the dataset doesn't resolve.
     */
    List<ContentIssue> contentIssues(long projectId, UUID uuid, JsonNode payload);

    /** The record as of {@code revision} (current when {@code null}); empty for another asset type. */
    Optional<RecordDetail> find(long projectId, UUID uuid, Long revision);

    /**
     * One page of a dataset's current records.
     *
     * @throws com.acme.staticforge.common.SfException {@code 400} with {@code column} for an invalid
     *     {@code where}, {@code 400} for an unknown or unsortable sort field
     */
    RecordPage list(long projectId, UUID datasetUuid, RecordListQuery query, int page, int size);

    /**
     * A record listing query: {@code q} matches display names (case-insensitive substring),
     * {@code folder} is a Content-store-relative folder prefix, {@code where} an OCTL expression over
     * bare field names, {@code sort} explicit keys (default order when empty).
     */
    record RecordListQuery(String q, String folder, String where, List<SortKey> sort) {

        public RecordListQuery {
            sort = sort == null ? List.of() : List.copyOf(sort);
        }
    }
}
