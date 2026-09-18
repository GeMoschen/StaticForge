package com.acme.staticforge.generate.postprocess;

/**
 * A rendered page summary used by the sitemap and search-index post-processors (spec §18.2 POST).
 * {@code path} is the normalized output path (no leading slash).
 *
 * <p>Each output of a paginated page (M21.2.2) is its own site page with the page's uid, carrying its
 * {@code pageNumber} of {@code totalPages}; both are {@code null} for a page that isn't paginated.
 *
 * <p>{@code locale} is the language the output was rendered in (M24.3.2), {@code null} in a project
 * without locales. Outputs of one page that differ only by language are each other's {@code hreflang}
 * alternates.
 */
public record SitePage(
        String uid,
        String path,
        String channel,
        String title,
        Integer pageNumber,
        Integer totalPages,
        String locale) {

    public SitePage {
        path = path == null ? "" : path;
        uid = uid == null ? "" : uid;
        channel = channel == null ? "" : channel;
        title = title == null ? "" : title;
    }

    /** A page that isn't paginated, in a project without locales. */
    public SitePage(String uid, String path, String channel, String title) {
        this(uid, path, channel, title, null, null, null);
    }

    /** A page in a project without locales. */
    public SitePage(String uid, String path, String channel, String title, Integer pageNumber, Integer totalPages) {
        this(uid, path, channel, title, pageNumber, totalPages, null);
    }
}
