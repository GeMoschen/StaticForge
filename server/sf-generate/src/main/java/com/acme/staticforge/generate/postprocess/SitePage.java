package com.acme.staticforge.generate.postprocess;

/**
 * A rendered page summary used by the sitemap and search-index post-processors (spec §18.2 POST).
 * {@code path} is the normalized output path (no leading slash).
 */
public record SitePage(String uid, String path, String channel, String title) {

    public SitePage {
        path = path == null ? "" : path;
        uid = uid == null ? "" : uid;
        channel = channel == null ? "" : channel;
        title = title == null ? "" : title;
    }
}
