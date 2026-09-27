package com.acme.staticforge.asset.page;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * The page payload's navigation settings (spec §10.3): {@code nav{visible, position, label, noIndex}}. One place that
 * reads them, so the editor's save path, generation (sitemap, {@code $CMS_META}), preview and the quality checks agree
 * on their defaults.
 */
public final class PageNav {

    /** The payload member holding the navigation settings. */
    public static final String NAV = "nav";

    /** {@code nav.noIndex}: keep the page out of search engines (M30, epic decision 12). */
    public static final String NO_INDEX = "noIndex";

    private PageNav() {}

    /**
     * Whether the page with {@code payload} asks search engines not to index it: {@code nav.noIndex} is {@code true}.
     * Missing (every page saved before M30), {@code null} or not a boolean reads as {@code false}.
     */
    public static boolean noIndex(JsonNode payload) {
        if (payload == null) {
            return false;
        }
        JsonNode value = payload.path(NAV).path(NO_INDEX);
        return value.isBoolean() && value.booleanValue();
    }
}
