package com.acme.staticforge.redirect;

import java.util.UUID;

/**
 * A redirect as {@link RedirectResolver} reads it: a stored {@link RedirectEntry} ({@link RedirectEntry#rule()}) or a
 * candidate a build has not stored yet (M30.4.2). Exactly one of the targets is set: {@code toAssetUuid} with
 * {@code toPageNumber}, or {@code toPath}.
 *
 * @param id the entry's id; {@code null} for a candidate
 * @param channel the channel key
 * @param locale the locale key; the empty string in a project without locales ({@code null} reads as empty)
 * @param fromPath the normalized source output path ({@link RedirectPaths})
 * @param toAssetUuid the target page, or {@code null}
 * @param toPageNumber the 1-based page number of the target page ({@code null} reads as 1)
 * @param toPath a fixed target output path (optionally with query and fragment) or absolute URL, or {@code null}
 */
public record RedirectRule(
        Long id, String channel, String locale, String fromPath, UUID toAssetUuid, Integer toPageNumber, String toPath) {

    public RedirectRule {
        locale = locale == null ? "" : locale;
        if ((toAssetUuid == null) == (toPath == null)) {
            throw new IllegalArgumentException("A redirect has exactly one target: a page or a path.");
        }
    }

    /** A redirect to page {@code pageNumber} of {@code asset}. */
    public static RedirectRule toAsset(String channel, String locale, String fromPath, UUID asset, int pageNumber) {
        return new RedirectRule(null, channel, locale, fromPath, asset, pageNumber, null);
    }

    /** A redirect to a fixed output path or URL. */
    public static RedirectRule toPath(String channel, String locale, String fromPath, String toPath) {
        return new RedirectRule(null, channel, locale, fromPath, null, null, toPath);
    }

    /** The target page number; 1 when unset. */
    public int pageNumber() {
        return toPageNumber == null ? 1 : toPageNumber;
    }
}
