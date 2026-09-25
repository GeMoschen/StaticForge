package com.acme.staticforge.release;

import java.util.UUID;

/**
 * One entry of a release, unpublish or discard request (M27.1.2).
 *
 * @param assetUuid the asset
 * @param locale the locale key, or {@code null} for every locale key the asset has; a declared locale given for an
 *     asset released under {@link ReleaseLocales#ALL} (non-localized media) means that shared key
 * @param pinnedVersionId the version to release instead of the open one (a scheduled release pinned at scheduling
 *     time, M27.4.2); {@code null} for the draft. Ignored by unpublish and discard.
 */
public record ReleaseItem(UUID assetUuid, String locale, Long pinnedVersionId) {

    /** Every locale of {@code assetUuid}, at its draft. */
    public static ReleaseItem of(UUID assetUuid) {
        return new ReleaseItem(assetUuid, null, null);
    }

    /** One locale of {@code assetUuid}, at its draft. */
    public static ReleaseItem of(UUID assetUuid, String locale) {
        return new ReleaseItem(assetUuid, locale, null);
    }
}
