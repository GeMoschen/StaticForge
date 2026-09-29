package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/**
 * The URLs of one asset, for its editor's URLs section (M32.7).
 *
 * @param targetType the registry target type of the asset ({@code PAGE}, {@code MEDIA}, {@code FOLDER}); {@code null}
 *     for an asset that has no URL of its own
 * @param indexPages for a pages folder: the page whose URL it uses, per channel that has one
 * @param entries every row of the asset, both areas
 */
public record UrlRegistryAssetView(
        UUID uuid, String targetType, List<IndexPageView> indexPages, List<UrlRegistryEntryView> entries) {

    /** A folder's index page in one channel. */
    public record IndexPageView(String channelKey, UUID pageUuid, String pageLabel) {}
}
