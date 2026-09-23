package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.query.DatasetQuery;
import java.util.List;

/**
 * How one template reads one record set, {@code recordset:<uid>} (M25.2.3) — what incremental planning needs to tell
 * whether a record change or a record template change can alter the template's output.
 *
 * @param loops the arguments of every {@code $CMS_FOR(x : recordset:uid, …)$} loop, nested loops included; the
 *     query of a loop without arguments selects every record the set shows
 * @param valueReads whether the template reads the set other than as a loop source: the value form
 *     {@code $CMS_VALUE(recordset:uid)$} (which renders every selected record through the dataset's record template),
 *     a path into the set's root value object ({@code recordset:uid._count}, {@code .records}), a condition or a
 *     loop's {@code where}
 */
public record RecordSetReads(List<DatasetQuery> loops, boolean valueReads) {

    /** A template that doesn't read the set. */
    public static final RecordSetReads NONE = new RecordSetReads(List.of(), false);

    public RecordSetReads {
        loops = List.copyOf(loops);
    }

    /** Whether the template reads the set at all. */
    public boolean isEmpty() {
        return loops.isEmpty() && !valueReads;
    }
}
