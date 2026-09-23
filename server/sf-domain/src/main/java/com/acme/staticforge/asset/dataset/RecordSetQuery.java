package com.acme.staticforge.asset.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The stored query of a record set (M25, epic decision 3): which of the set's records are shown and in
 * which order. Every part is optional; the empty query selects every record in the default order
 * ({@code _displayName}, {@code _uid}).
 *
 * <p>{@code where} is an OCTL expression over bare field names, {@code sort} the loop sort-key syntax
 * ({@code "name,-joined"}), {@code limit}/{@code offset} slice the result. It is persisted as the set
 * payload's {@code query} object, holding only the parts that are set.
 */
public record RecordSetQuery(String where, String sort, Integer limit, Integer offset) {

    /** The query that selects every record in the default order. */
    public static final RecordSetQuery ALL = new RecordSetQuery(null, null, null, null);

    /** Blank {@code where}/{@code sort} mean none. */
    public RecordSetQuery {
        where = where == null || where.isBlank() ? null : where.strip();
        sort = sort == null || sort.isBlank() ? null : sort.strip();
    }

    /** {@code null} (no query given) is {@link #ALL}. */
    public static RecordSetQuery orAll(RecordSetQuery query) {
        return query == null ? ALL : query;
    }

    /** Reads a payload's {@code query} object; a missing or malformed one is {@link #ALL}. */
    public static RecordSetQuery fromJson(JsonNode query) {
        if (query == null || !query.isObject()) {
            return ALL;
        }
        return new RecordSetQuery(text(query, "where"), text(query, "sort"), integer(query, "limit"), integer(query, "offset"));
    }

    /** The {@code query} object stored in the set payload. */
    public ObjectNode toJson() {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        if (where != null) {
            node.put("where", where);
        }
        if (sort != null) {
            node.put("sort", sort);
        }
        if (limit != null) {
            node.put("limit", limit);
        }
        if (offset != null) {
            node.put("offset", offset);
        }
        return node;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isTextual() ? value.asText() : null;
    }

    private static Integer integer(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.canConvertToInt() && value.isIntegralNumber() ? value.intValue() : null;
    }
}
