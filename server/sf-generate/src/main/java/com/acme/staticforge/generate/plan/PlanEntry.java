package com.acme.staticforge.generate.plan;

import java.util.UUID;

/**
 * A single unit of rendering work (spec §18.3): one page materialized for one channel to a
 * concrete output path. The {@code outputPath} is relative, forward-slash, with no leading
 * slash and no {@code ..} segments (see {@code OutputFile.normalize}).
 *
 * <p>A paginated page (M21.2.1) has one entry per page number per channel, each carrying its
 * {@link Pagination}; {@code pagination} is {@code null} for every other page. A localized project
 * (M24.3.2) has one entry per page × channel × locale, each carrying its {@code locale};
 * {@code locale} is {@code null} in a project without locales, which keeps its plan identical to
 * a pre-M24 build.
 */
public record PlanEntry(UUID pageUuid, String channel, String outputPath, Pagination pagination, String locale) {

    /** An entry of a page that isn't paginated, in a project without locales. */
    public PlanEntry(UUID pageUuid, String channel, String outputPath) {
        this(pageUuid, channel, outputPath, null, null);
    }

    /** An entry of a paginated page in a project without locales. */
    public PlanEntry(UUID pageUuid, String channel, String outputPath, Pagination pagination) {
        this(pageUuid, channel, outputPath, pagination, null);
    }

    /** The same entry rendered for {@code locale} and written to {@code path}. */
    public PlanEntry withLocale(String locale, String path) {
        return new PlanEntry(pageUuid, channel, path, pagination, locale);
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
