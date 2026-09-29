package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A URL registry row in an export archive (M32.6, protocol {@code 11}): one element of {@code url-registry.json}. Only
 * {@code GENERATED} rows travel — a preview's URLs are recomputed from the drafts. The target is named by its asset
 * uuid (asset uuids survive an import, M9).
 *
 * @param targetType {@code PAGE}, {@code MEDIA} or {@code FOLDER}
 * @param channel the channel key; {@code ""} for media
 * @param locale the language key; {@code ""} for a row without a language
 * @param variant a media variant's name; {@code ""} otherwise
 * @param pageNumber the page number of a paginated page's output; {@code 1} otherwise
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ExportedUrl(
        String targetType,
        String targetUuid,
        String channel,
        String locale,
        String variant,
        int pageNumber,
        String url,
        boolean overridden) {

    /** "page 3a0…, html (de): de/about.html" — the element label of an import warning. */
    String label() {
        String where = (channel == null || channel.isEmpty() ? "" : channel)
                + (locale == null || locale.isEmpty() ? "" : " (" + locale + ")");
        return targetType.toLowerCase(java.util.Locale.ROOT) + " " + targetUuid
                + (where.isEmpty() ? "" : ", " + where) + ": " + url;
    }
}
