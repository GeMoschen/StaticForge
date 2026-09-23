package com.acme.staticforge.template.render;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.query.RecordSetQueries;
import com.acme.staticforge.template.query.RecordView;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * A record set as the data a render reads it from (M25.2.2): the set's identity, its dataset, its stored query
 * compiled against the dataset's schema, and its live records. {@link AssetValueResolver#recordSet} supplies it —
 * generation from the build snapshot (records from the index built once per snapshot), preview from the versions
 * valid at the preview revision — and the {@link OctlRenderer} selects, loops and renders from it, so both
 * pipelines render a set through the same code.
 *
 * <p>The records are unselected and unresolved: the renderer runs {@link RecordSetQueries#select} with the render's
 * locale chain (and a loop's narrowing), which is why the source carries the compiled query rather than a result.
 *
 * @param uuid the set's UUID
 * @param uid the set's uid ({@code _meta.uid}, diagnostics)
 * @param displayName the set's display name ({@code _meta.displayName})
 * @param datasetUuid the set's dataset, {@code null} when its payload names none
 * @param datasetUid the dataset's uid ({@code _meta.dataset}), {@code null} when unknown
 * @param query the stored query compiled against the dataset's schema; an invalid one selects nothing
 * @param datasetDefinition the dataset's schema, {@code null} when it can't be read — used to check a
 *     reference-editor loop's {@code where}/{@code sort} fields at render time
 * @param records the set's live records, in any order; soft-deleted records are never included
 */
public record RecordSetSource(
        UUID uuid,
        String uid,
        String displayName,
        UUID datasetUuid,
        String datasetUid,
        RecordSetQueries.Compiled query,
        ContentDefinition datasetDefinition,
        List<RecordView> records) {

    public RecordSetSource {
        Objects.requireNonNull(uuid, "uuid");
        Objects.requireNonNull(query, "query");
        uid = uid == null ? "" : uid;
        displayName = displayName == null ? "" : displayName;
        records = records == null ? List.of() : List.copyOf(records);
    }
}
