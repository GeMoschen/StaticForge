package com.acme.staticforge.template.query;

import com.acme.staticforge.template.octl.Expr;
import java.util.List;

/**
 * A parsed dataset query (M19.3.1): which records of a dataset a loop, a listing or a paginated
 * page sees, and in which order. Immutable; a compiled template holds one per dataset loop.
 *
 * <p>Order of operations ({@link DatasetQueryEvaluator}): {@code folder} → {@code where} →
 * {@code sort} → {@code offset} → {@code limit}.
 *
 * @param variable the loop variable a {@code where} expression addresses record fields through
 *     ({@code member} in {@code member.role == 'lead'}); {@code null} when fields are bare names (the
 *     REST listing, where there is no other scope)
 * @param where the filter, {@code null} for none
 * @param sort the sort keys; empty means the default order ({@code _displayName}, then {@code _uid})
 * @param limit the maximum number of records, {@code null} for no limit
 * @param offset the number of records skipped, {@code null} for none
 * @param folder a Content folder path prefix ({@code /team/}), {@code null} for the whole store
 */
public record DatasetQuery(String variable, Expr where, List<SortKey> sort, Integer limit, Integer offset, String folder) {

    public DatasetQuery {
        sort = sort == null ? List.of() : List.copyOf(sort);
        folder = folder == null || folder.isBlank() ? null : RecordView.normalizeFolder(folder);
    }

    /** No filter, default order, everything. */
    public static DatasetQuery all(String variable) {
        return new DatasetQuery(variable, null, List.of(), null, null, null);
    }

    /** The same query without {@code limit} and {@code offset}: what a count or a paginator needs. */
    public DatasetQuery unbounded() {
        return new DatasetQuery(variable, where, sort, null, null, folder);
    }
}
