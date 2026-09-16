package com.acme.staticforge.template.query;

/**
 * One key of a dataset query's sort order (M19.3.1): a record field ({@code name}) or a meta field
 * ({@code _displayName}, {@code _uid}, {@code _changedAt}, …) and its direction.
 */
public record SortKey(String field, Direction direction) {

    public enum Direction {
        ASC,
        DESC
    }

    public static SortKey asc(String field) {
        return new SortKey(field, Direction.ASC);
    }

    public static SortKey desc(String field) {
        return new SortKey(field, Direction.DESC);
    }

    public boolean descending() {
        return direction == Direction.DESC;
    }
}
