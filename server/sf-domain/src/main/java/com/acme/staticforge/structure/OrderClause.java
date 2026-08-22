package com.acme.staticforge.structure;

/**
 * One {@code order by} clause (spec §17.1): a page-scope field path (for example
 * {@code "nav.position"} or {@code "displayName"}) plus a sort direction.
 */
public record OrderClause(String field, boolean ascending) {

    public OrderClause {
        field = field == null ? "" : field;
    }
}
