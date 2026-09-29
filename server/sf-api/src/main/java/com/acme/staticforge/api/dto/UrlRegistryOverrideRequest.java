package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * A manual URL. {@code PATCH .../url-registry/{id}} reads only {@code url} (the row names the rest); {@code PUT
 * .../url-registry} (M32.7) names the target, so an asset's URL can be set before any build or preview assigned one.
 *
 * @param targetType {@code PAGE}, {@code MEDIA} or {@code FOLDER}
 * @param variant a media variant's name; blank or {@code null} for the primary file and for other targets
 * @param pageNumber a paginated page's page number; {@code null} for 1
 * @param channelKey the channel; ignored for media
 * @param area {@code GENERATED} or {@code PREVIEW}
 * @param locale the language key; blank or {@code null} for a row without a language
 */
public record UrlRegistryOverrideRequest(
        String url,
        String targetType,
        UUID targetUuid,
        String variant,
        Integer pageNumber,
        String channelKey,
        String area,
        String locale) {

    /** A body naming only the URL ({@code PATCH}). */
    public UrlRegistryOverrideRequest(String url) {
        this(url, null, null, null, null, null, null, null);
    }
}
