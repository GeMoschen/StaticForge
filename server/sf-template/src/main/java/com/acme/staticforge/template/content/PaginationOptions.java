package com.acme.staticforge.template.content;

import java.util.List;

/**
 * The declaration of a {@code pagination} editor (M21.1.1): which source kinds an editor may pick, the default and
 * maximum page size, and the offered sort keys (the first is the default).
 *
 * @param sources the allowed source kinds, lowercase: {@value #NAV} and/or {@value #DATASET}
 * @param pageSize the default page size, {@code 1..}{@value #MAX_PAGE_SIZE}
 * @param maxPageSize the upper bound for an editor-picked page size; {@code null} means {@value #MAX_PAGE_SIZE}
 * @param sort the offered sort keys: {@code navigation}, {@code position}, {@code date} and {@code displayName} for a
 *     navigation source, a declared scalar field (or {@code _displayName}, {@code _uid}, {@code _changedAt}) for a
 *     dataset source
 */
public record PaginationOptions(List<String> sources, int pageSize, Integer maxPageSize, List<String> sort) {

    /** The {@code nav} source kind: the page references directly in a navigation folder. */
    public static final String NAV = "nav";
    /** The {@code dataset} source kind: the records of a dataset. */
    public static final String DATASET = "dataset";
    /** The source kinds a {@code pagination} editor may allow. */
    public static final List<String> SOURCE_KINDS = List.of(NAV, DATASET);
    /** The sort keys of a navigation source. */
    public static final List<String> NAV_SORT_KEYS = List.of("navigation", "position", "date", "displayName");
    /** The largest page size, and the bound when {@code maxPageSize} is absent. */
    public static final int MAX_PAGE_SIZE = 1000;
    /** The page size when the declaration has none. */
    public static final int DEFAULT_PAGE_SIZE = 10;

    public PaginationOptions {
        sources = sources == null || sources.isEmpty() ? List.of(NAV) : List.copyOf(sources);
        sort = sort == null || sort.isEmpty() ? defaultSort(sources) : List.copyOf(sort);
    }

    /** The largest page size an editor may pick. */
    public int effectiveMaxPageSize() {
        return maxPageSize == null ? MAX_PAGE_SIZE : maxPageSize;
    }

    /** Whether {@code kind} (case-insensitive, {@code NAV}/{@code nav}) is allowed. */
    public boolean allows(String kind) {
        return kind != null && sources.contains(kind.toLowerCase(java.util.Locale.ROOT));
    }

    /** No declared sort: tree order for a navigation source, the dataset's default order otherwise. */
    private static List<String> defaultSort(List<String> sources) {
        return sources.contains(NAV) ? List.of("navigation") : List.of("_displayName");
    }
}
