package com.acme.staticforge.generate.plan;

import java.util.UUID;

/**
 * A single unit of rendering work (spec §18.3): one page materialized for one channel to a
 * concrete output path. The {@code outputPath} is relative, forward-slash, with no leading
 * slash and no {@code ..} segments (see {@code OutputFile.normalize}).
 *
 * <p>A paginated page (M21.2.1) has one entry per page number per channel, each carrying its
 * {@link Pagination}; {@code pagination} is {@code null} for every other page. The components are
 * not a closed key: a later dimension (locale, M24) adds a component rather than a new key format.
 */
public record PlanEntry(UUID pageUuid, String channel, String outputPath, Pagination pagination) {

    /** An entry of a page that isn't paginated. */
    public PlanEntry(UUID pageUuid, String channel, String outputPath) {
        this(pageUuid, channel, outputPath, null);
    }

    /** The 1-based page number; {@code 1} for a page that isn't paginated. */
    public int pageNumber() {
        return pagination == null ? 1 : pagination.pageNumber();
    }

    /**
     * Page {@code pageNumber} of a paginated page in one channel.
     *
     * @param page what every page number of the page in this channel shares: the items and every page's path
     */
    public record Pagination(int pageNumber, PaginatedPage page) {

        public int totalPages() {
            return page.totalPages();
        }
    }
}
